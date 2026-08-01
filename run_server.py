import os
import sys
import atexit
import asyncio
import argparse
from pathlib import Path
import tomli
import uvicorn
from loguru import logger
from upgrade_codes.upgrade_manager import UpgradeManager

from src.open_llm_vtuber.server import WebSocketServer
from src.open_llm_vtuber.config_manager import Config, read_yaml, validate_config

os.environ["HF_HOME"] = str(Path(__file__).parent / "models")
os.environ["MODELSCOPE_CACHE"] = str(Path(__file__).parent / "models")

upgrade_manager = UpgradeManager()


def get_version() -> str:
    with open("pyproject.toml", "rb") as f:
        pyproject = tomli.load(f)
    return pyproject["project"]["version"]


def init_logger(console_log_level: str = "INFO", write_debug_log: bool = True) -> None:
    logger.remove()
    # Console output
    logger.add(
        sys.stderr,
        level=console_log_level,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | {message}",
        colorize=True,
    )

    if write_debug_log:
        logger.add(
            "logs/debug_{time:YYYY-MM-DD}.log",
            rotation="10 MB",
            retention="30 days",
            level="DEBUG",
            format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} | {message} | {extra}",
            backtrace=True,
            diagnose=True,
        )


def check_frontend(lang=None):
    """Check that the frontend files tracked in this repository are present."""
    if lang is None:
        lang = upgrade_manager.lang

    frontend_path = Path(__file__).parent / "frontend" / "index.html"
    built_frontend_path = Path(__file__).parent / "frontend" / "dist" / "web" / "index.html"
    if not frontend_path.exists() and not built_frontend_path.exists():
        if lang == "zh":
            logger.critical("前端文件缺失，请重新获取仓库中的 `frontend` 目录。")
        else:
            logger.critical("Frontend files are missing. Restore the `frontend` directory from this repository.")


def parse_args():
    parser = argparse.ArgumentParser(description="Open-LLM-VTuber Server")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument(
        "--hf_mirror", action="store_true", help="Use Hugging Face mirror"
    )
    parser.add_argument("--host", help="Override the configured listen host")
    parser.add_argument("--port", type=int, help="Override the configured listen port")
    parser.add_argument(
        "--container",
        action="store_true",
        help="Container mode: skip Git/config writes and log only to stdout",
    )
    return parser.parse_args()


@logger.catch
def run(
    console_log_level: str,
    host_override: str | None = None,
    port_override: int | None = None,
    container: bool = False,
):
    init_logger(console_log_level, write_debug_log=not container)
    logger.info(f"Open-LLM-VTuber, version v{get_version()}")

    if not container:
        # Get selected language
        lang = upgrade_manager.lang

        check_frontend(lang)

        # Sync user config with default config
        try:
            upgrade_manager.sync_user_config()
        except Exception as e:
            logger.error(f"Error syncing user config: {e}")

    atexit.register(WebSocketServer.clean_cache)

    # Load configurations from yaml file
    config: Config = validate_config(read_yaml("conf.yaml"))
    server_config = config.system_config

    if server_config.enable_proxy:
        logger.info("Proxy mode enabled - /proxy-ws endpoint will be available")

    # Initialize the WebSocket server (synchronous part)
    server = WebSocketServer(config=config)

    # Perform asynchronous initialization (loading context, etc.)
    logger.info("Initializing server context...")
    try:
        asyncio.run(server.initialize())
        logger.info("Server context initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize server context: {e}")
        sys.exit(1)  # Exit if initialization fails

    # Run the Uvicorn server
    host = host_override or server_config.host
    port = port_override or server_config.port
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(
        app=server.app,
        host=host,
        port=port,
        log_level=console_log_level.lower(),
    )


if __name__ == "__main__":
    args = parse_args()
    console_log_level = "DEBUG" if args.verbose else "INFO"
    if args.verbose:
        logger.info("Running in verbose mode")
    else:
        logger.info(
            "Running in standard mode. For detailed debug logs, use: uv run run_server.py --verbose"
        )
    if args.hf_mirror:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
    run(
        console_log_level=console_log_level,
        host_override=args.host,
        port_override=args.port,
        container=args.container,
    )
