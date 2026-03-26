import logging
import sys
import time
import traceback
from pathlib import Path

from db import TaskStatus, Task
from db.database import SessionLocal

from poc_file_storage.storage.local import LocalPersistentStorage
from core.logger import setup_logging
from core.config import DATA_DIR

from db.crud.tasks import update_task, get_pending_task
from poc_ml_worker.engine import run_inference 

logger = logging.getLogger(__name__)

class MLWorker:
    """Main ML inference worker."""
    
    def __init__(self, session_factory, storage: LocalPersistentStorage):
        self.session_factory = session_factory
        self.storage = storage
        self.poll_interval = 2 
        logger.info(f"MLWorker initialized with data_dir={self.storage.root}")
    
    def run(self) -> None:
        """ML Worker queue watcher."""
        logger.info("Starting ML Worker polling loop...")
        
        try:
            iteration = 0
            while True:
                iteration += 1
                
                try:
                    with self.session_factory() as db:
                        task = get_pending_task(db)
                        
                        if task:
                            self.orchestrate_task(db, task)
                        else:
                            if iteration % 10 == 0:  
                                logger.debug(f"No tasks in queue (iteration {iteration}), sleeping...")
                            time.sleep(self.poll_interval)
                            
                except Exception as e:
                    logger.error(f"Error in polling loop: {e}")
                    logger.error(traceback.format_exc())
                    time.sleep(self.poll_interval)
                    
        except KeyboardInterrupt:
            logger.info("Worker interrupted by user")
        except Exception as e:
            logger.critical(f"Worker crashed: {e}")
            logger.error(traceback.format_exc())
            raise

    def orchestrate_task(self, db, task: Task) -> None:
        """
        Process single inference task.
        """
        task_id = task.id
        logger.info(f"Processing task: {task_id}")
        logger.info(f"Study: {task.study_id}, File: {task.file_id}")
        
        try:
            update_task(db, task_id, status=TaskStatus.PROCESSING)
            db.commit()
            
            logger.info(f"Retrieving file {task.file_id} from storage...")
            stored_file = self.storage.get_file(task.file_id)
            input_path = str(self.storage.root / stored_file.rel_path)
            
            if not Path(input_path).exists():
                raise FileNotFoundError(f"Input file not found: {input_path}")
            
            logger.info(f"Input file path: {input_path}")
            
            with run_inference(input_path) as output_path:
                logger.info(f"Storing result to persistent storage...")
                
                result_file = self.storage.store_from_local_path(
                    study_id=task.study_id,
                    role="derived",
                    kind="segmentation",
                    src_path=output_path,
                    filename=f"segmentation_{task_id}.nii.gz",
                    content_type="application/gzip",
                )
            
            logger.info(f"Result stored with file_id: {result_file.id}")
            
            update_task(db, task_id, status=TaskStatus.COMPLETED, result_file_id=result_file.id)
            db.commit()
            
            logger.info(f"Task {task_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")
            logger.error(traceback.format_exc())
            
            try:
                update_task(db, task_id, status=TaskStatus.FAILED)
                db.commit()
            except Exception as update_error:
                logger.error(f"Failed to mark task as FAILED: {update_error}")
    


if __name__ == "__main__":
    setup_logging("ml_worker")
    logger = logging.getLogger(__name__)
    
    try:
        shared_storage = LocalPersistentStorage(root=DATA_DIR)
        
        worker = MLWorker(
            session_factory=SessionLocal, 
            storage=shared_storage
        )
        worker.run()
        
    except Exception as e:
        logger.critical(f"Failed to start worker: {e}")
        sys.exit(1)