import logging.config
from pathlib import Path

def setup_logging(module_name: str = "app"):
    _repo_root = Path(__file__).resolve().parents[3]
    log_dir = _repo_root / "packages" / "application" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    LOGGING_CONFIG = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
            "colored": {
                "()": "colorlog.ColoredFormatter",
                "format": "%(log_color)s%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                "log_colors": {
                    "DEBUG": "cyan", "INFO": "green", "WARNING": "yellow", "ERROR": "red", "CRITICAL": "bold_red",
                },
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "level": "INFO", 
                "formatter": "colored",
                "stream": "ext://sys.stdout",
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "level": "INFO",
                "formatter": "standard",
                "filename": str(log_dir / f"{module_name}.log"),
                "maxBytes": 10 * 1024 * 1024,
                "backupCount": 5,
                "encoding": "utf8",
            },
        },
        "root": {
            "level": "INFO",
            "handlers": ["console", "file"],
        },
    }
    
    logging.config.dictConfig(LOGGING_CONFIG)
