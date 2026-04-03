from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "kimi-k2.5"
    port: int = 8001
    base_path: str = "/diagnouze"
    access_token: str = ""
    default_workspace: str = "supply-chain"
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "dataagent"

    class Config:
        env_file = ".env"


settings = Settings()
