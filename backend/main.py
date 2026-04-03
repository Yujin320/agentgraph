import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from backend.config import settings
from backend.routers import chat, workspace, explorer, pipeline as pipeline_router

BASE_PATH = settings.base_path.rstrip("/")

app = FastAPI(title="DataAgent v2 API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_LOGIN_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DataAgent — 请登录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
     background:#f0f2f5;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border-radius:12px;padding:48px 40px;width:360px;
      box-shadow:0 4px 24px rgba(0,0,0,.10)}
h1{font-size:22px;color:#1a1a2e;margin-bottom:8px;text-align:center}
p{color:#888;font-size:13px;text-align:center;margin-bottom:32px}
label{display:block;font-size:13px;color:#555;margin-bottom:6px}
input[type=password]{width:100%;padding:10px 14px;border:1px solid #d9d9d9;
  border-radius:8px;font-size:15px;outline:none;transition:border-color .2s}
input[type=password]:focus{border-color:#4f46e5}
button{margin-top:20px;width:100%;padding:11px;background:#4f46e5;color:#fff;
  border:none;border-radius:8px;font-size:15px;cursor:pointer;transition:background .2s}
button:hover{background:#4338ca}
.err{color:#e53e3e;font-size:13px;margin-top:12px;text-align:center;display:none}
</style>
</head>
<body>
<div class="card">
  <h1>DataAgent 智能归因</h1>
  <p>请输入访问密码</p>
  <label for="pwd">密码</label>
  <input type="password" id="pwd" placeholder="访问令牌" autofocus>
  <button onclick="login()">进入系统</button>
  <div class="err" id="err">密码错误，请重试</div>
</div>
<script>
function login() {
  var token = document.getElementById('pwd').value.trim();
  if (!token) return;
  document.cookie = 'access_token=' + token + ';path=/;max-age=31536000';
  localStorage.setItem('access_token', token);
  window.location.reload();
}
document.getElementById('pwd').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') login();
});
</script>
</body>
</html>"""


def _get_token(request: Request) -> str:
    """Extract token from Bearer header, query param, or cookie."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):]
    token = request.query_params.get("token", "")
    if token:
        return token
    return request.cookies.get("access_token", "")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not settings.access_token:
        return await call_next(request)

    path = request.url.path
    token = _get_token(request)

    if token != settings.access_token:
        # Static assets — return 401 JSON
        if path.startswith(f"{BASE_PATH}/assets/"):
            return JSONResponse(status_code=401, content={"error": "未授权访问"})
        # HTML page requests — serve the login page
        accept = request.headers.get("Accept", "")
        if "text/html" in accept or path in (BASE_PATH, BASE_PATH + "/") or path == "/":
            return HTMLResponse(content=_LOGIN_PAGE, status_code=401)
        # API and other requests — return JSON 401
        return JSONResponse(status_code=401, content={"error": "未授权访问"})

    return await call_next(request)


# Register API routers
app.include_router(chat.router, prefix=f"{BASE_PATH}/api")
app.include_router(workspace.router, prefix=f"{BASE_PATH}/api")
app.include_router(explorer.router, prefix=f"{BASE_PATH}/api")
app.include_router(pipeline_router.router, prefix=f"{BASE_PATH}/api")


@app.get(f"{BASE_PATH}/api/health", tags=["system"])
def health():
    return {"status": "ok", "version": "2.0", "default_workspace": settings.default_workspace}


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"error": str(exc)})


@app.exception_handler(FileNotFoundError)
async def not_found_handler(request: Request, exc: FileNotFoundError):
    return JSONResponse(status_code=404, content={"error": str(exc)})


# --- Frontend SPA static hosting (must come last) ---
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _FRONTEND_DIR.is_dir():
    _assets_dir = _FRONTEND_DIR / "assets"
    if _assets_dir.is_dir():
        app.mount(
            f"{BASE_PATH}/assets",
            StaticFiles(directory=str(_assets_dir)),
            name="frontend-assets",
        )

    @app.get(BASE_PATH + "/favicon.svg")
    def favicon():
        return FileResponse(str(_FRONTEND_DIR / "favicon.svg"))

    @app.get(BASE_PATH)
    @app.get(BASE_PATH + "/")
    @app.get(BASE_PATH + "/{full_path:path}")
    def serve_spa(full_path: str = ""):
        return FileResponse(str(_FRONTEND_DIR / "index.html"))
