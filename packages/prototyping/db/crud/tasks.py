from sqlalchemy.orm import Session
from db import Task
from db import TaskStatus

from sqlalchemy import select
from db.models import Task

import logging
logger = logging.getLogger(__name__)

def get_pending_task(db: Session):
    query = select(Task).where(Task.status == "PENDING").limit(1)
    result = db.execute(query)
    
    return result.scalar_one_or_none()

def update_task(db: Session, task_id: str, **updates):
    stmt = select(Task).where(Task.id == task_id)
    task = db.execute(stmt).scalar_one_or_none()
    
    if not task:
        logger.warning(f"No task with given id: {task_id}")
        return None

    for key, value in updates.items():
        if hasattr(task, key):
            setattr(task, key, value)
        else:
            logger.error(f"Task does not have a field named: {key}")

    return task