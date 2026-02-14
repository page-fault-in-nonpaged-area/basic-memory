"""MCP server locking mechanism for project-scoped isolation.

Ensures only one MCP server runs per config directory (project).
Prevents multiple servers from accessing the same database and causing conflicts.
"""

import os
import signal
from pathlib import Path
from typing import Optional
from loguru import logger


LOCK_FILE_NAME = ".mcp.lock"


class McpLockError(Exception):
    """Raised when MCP server lock operations fail."""

    pass


class McpServerLock:
    """Project-scoped MCP server lock.

    Uses PID-based locking to ensure only one MCP server runs per project.
    The lock file is stored in the config directory (e.g., .agent-memory/.mcp.lock).
    """

    def __init__(self, config_dir: Path):
        """Initialize lock for the given config directory.

        Args:
            config_dir: Path to the Basic Memory config directory
        """
        self.config_dir = Path(config_dir)
        self.lock_file = self.config_dir / LOCK_FILE_NAME
        self.pid = os.getpid()

    def _read_lock(self) -> Optional[int]:
        """Read PID from lock file.

        Returns:
            PID from lock file, or None if lock doesn't exist or is invalid
        """
        if not self.lock_file.exists():
            return None

        try:
            content = self.lock_file.read_text().strip()
            return int(content)
        except (ValueError, OSError) as e:
            logger.warning(f"Invalid lock file content: {e}")
            return None

    def _process_exists(self, pid: int) -> bool:
        """Check if a process with given PID is running.

        Args:
            pid: Process ID to check

        Returns:
            True if process is running, False otherwise
        """
        try:
            # Signal 0 doesn't actually send a signal, just checks if process exists
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    def _kill_process(self, pid: int) -> bool:
        """Kill process with given PID.

        Args:
            pid: Process ID to kill

        Returns:
            True if process was killed, False otherwise
        """
        try:
            # Try graceful shutdown first (SIGTERM)
            logger.info(f"Sending SIGTERM to existing MCP server (PID {pid})")
            os.kill(pid, signal.SIGTERM)
            
            # Give it a moment to shut down gracefully
            import time
            time.sleep(1)
            
            # Check if it's still running
            if self._process_exists(pid):
                logger.warning(f"Process {pid} didn't respond to SIGTERM, sending SIGKILL")
                os.kill(pid, signal.SIGKILL)
            
            logger.info(f"Successfully terminated existing MCP server (PID {pid})")
            return True
        except OSError as e:
            logger.warning(f"Failed to kill process {pid}: {e}")
            return False

    def _write_lock(self) -> None:
        """Write current PID to lock file."""
        try:
            self.config_dir.mkdir(parents=True, exist_ok=True)
            self.lock_file.write_text(str(self.pid))
            logger.debug(f"Wrote lock file with PID {self.pid}: {self.lock_file}")
        except OSError as e:
            raise McpLockError(f"Failed to write lock file: {e}")

    def _remove_lock(self) -> None:
        """Remove lock file."""
        try:
            if self.lock_file.exists():
                self.lock_file.unlink()
                logger.debug(f"Removed lock file: {self.lock_file}")
        except OSError as e:
            logger.warning(f"Failed to remove lock file: {e}")

    def acquire(self) -> None:
        """Acquire the lock, killing any existing server if necessary.

        This ensures only one MCP server runs per project (config directory).

        Raises:
            McpLockError: If lock cannot be acquired
        """
        logger.debug(f"Acquiring MCP server lock for {self.config_dir}")

        # Check for existing lock
        existing_pid = self._read_lock()

        if existing_pid:
            # Check if the process is still running
            if self._process_exists(existing_pid):
                logger.warning(
                    f"Found running MCP server (PID {existing_pid}) for same config directory. "
                    f"Terminating to ensure single server per project."
                )
                
                # Kill the existing server to prevent conflicts
                if self._kill_process(existing_pid):
                    # Remove stale lock
                    self._remove_lock()
                else:
                    raise McpLockError(
                        f"Could not terminate existing MCP server (PID {existing_pid})"
                    )
            else:
                # Stale lock (process doesn't exist)
                logger.info(f"Removing stale lock file (PID {existing_pid} not running)")
                self._remove_lock()

        # Write new lock with current PID
        self._write_lock()
        logger.info(
            f"Acquired MCP server lock (PID {self.pid}) for project at {self.config_dir}"
        )

    def release(self) -> None:
        """Release the lock by removing the lock file.

        Should be called on server shutdown.
        """
        logger.debug(f"Releasing MCP server lock (PID {self.pid})")
        
        # Only remove lock if it's ours
        current_pid = self._read_lock()
        if current_pid == self.pid:
            self._remove_lock()
            logger.info(f"Released MCP server lock for {self.config_dir}")
        else:
            logger.warning(
                f"Lock file PID ({current_pid}) doesn't match current PID ({self.pid}). "
                f"Not removing lock file."
            )

    def __enter__(self):
        """Context manager entry: acquire lock."""
        self.acquire()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit: release lock."""
        self.release()
        return False
