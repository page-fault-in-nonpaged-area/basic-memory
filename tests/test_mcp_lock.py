"""Tests for MCP server locking mechanism."""

import os
import signal
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from basic_memory.mcp.lock import McpServerLock, McpLockError, LOCK_FILE_NAME


@pytest.fixture
def lock_dir(tmp_path):
    """Create a temporary directory for lock tests."""
    return tmp_path / "test_locks"


def test_lock_acquire_creates_file(lock_dir):
    """Test that acquiring lock creates a lock file with PID."""
    lock = McpServerLock(lock_dir)
    
    lock.acquire()
    
    assert (lock_dir / LOCK_FILE_NAME).exists()
    assert (lock_dir / LOCK_FILE_NAME).read_text() == str(os.getpid())
    
    lock.release()


def test_lock_release_removes_file(lock_dir):
    """Test that releasing lock removes the lock file."""
    lock = McpServerLock(lock_dir)
    
    lock.acquire()
    assert (lock_dir / LOCK_FILE_NAME).exists()
    
    lock.release()
    assert not (lock_dir / LOCK_FILE_NAME).exists()


def test_lock_context_manager(lock_dir):
    """Test that lock works as a context manager."""
    with McpServerLock(lock_dir) as lock:
        assert (lock_dir / LOCK_FILE_NAME).exists()
        assert (lock_dir / LOCK_FILE_NAME).read_text() == str(os.getpid())
    
    # Lock should be released after context
    assert not (lock_dir / LOCK_FILE_NAME).exists()


def test_lock_kills_existing_process(lock_dir):
    """Test that acquiring lock kills existing process."""
    # Create a fake lock file with a different (fake) PID
    fake_pid = 999999
    lock_file = lock_dir / LOCK_FILE_NAME
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_file.write_text(str(fake_pid))
    
    lock = McpServerLock(lock_dir)
    
    # Mock process existence check to return True initially
    with patch.object(lock, '_process_exists') as mock_exists:
        with patch.object(lock, '_kill_process') as mock_kill:
            mock_exists.return_value = True
            mock_kill.return_value = True
            
            lock.acquire()
            
            # Should have tried to kill the process
            mock_kill.assert_called_once_with(fake_pid)
    
    # Should now have our PID in the lock file
    assert lock_file.read_text() == str(os.getpid())
    
    lock.release()


def test_lock_removes_stale_lock(lock_dir):
    """Test that stale lock (dead process) is removed."""
    # Create a fake lock file with a PID that doesn't exist
    fake_pid = 999999
    lock_file = lock_dir / LOCK_FILE_NAME
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_file.write_text(str(fake_pid))
    
    lock = McpServerLock(lock_dir)
    
    # Mock process existence check to return False (process dead)
    with patch.object(lock, '_process_exists') as mock_exists:
        mock_exists.return_value = False
        
        lock.acquire()
        
        # Should have checked if process exists
        mock_exists.assert_called_with(fake_pid)
    
    # Should now have our PID in the lock file
    assert lock_file.read_text() == str(os.getpid())
    
    lock.release()


def test_lock_fails_if_cannot_kill(lock_dir):
    """Test that lock acquisition fails if cannot kill existing process."""
    # Create a fake lock file with a different PID
    fake_pid = 999999
    lock_file = lock_dir / LOCK_FILE_NAME
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_file.write_text(str(fake_pid))
    
    lock = McpServerLock(lock_dir)
    
    # Mock process existence and kill to fail
    with patch.object(lock, '_process_exists') as mock_exists:
        with patch.object(lock, '_kill_process') as mock_kill:
            mock_exists.return_value = True
            mock_kill.return_value = False
            
            with pytest.raises(McpLockError, match="Could not terminate"):
                lock.acquire()


def test_lock_only_releases_own_lock(lock_dir):
    """Test that lock only releases if it owns the lock."""
    lock = McpServerLock(lock_dir)
    lock.acquire()
    
    # Simulate another process taking over the lock
    lock_file = lock_dir / LOCK_FILE_NAME
    lock_file.write_text("999999")
    
    # Release should not remove the lock file (it's not ours)
    lock.release()
    
    # Lock file should still exist with the other PID
    assert lock_file.exists()
    assert lock_file.read_text() == "999999"
    
    # Clean up
    lock_file.unlink()


def test_lock_handles_invalid_lock_content(lock_dir):
    """Test that lock handles invalid lock file content."""
    lock_file = lock_dir / LOCK_FILE_NAME
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_file.write_text("not-a-pid")
    
    lock = McpServerLock(lock_dir)
    
    # Should handle invalid content gracefully and acquire new lock
    lock.acquire()
    
    assert lock_file.read_text() == str(os.getpid())
    
    lock.release()


def test_lock_creates_config_dir(tmp_path):
    """Test that lock creates config directory if it doesn't exist."""
    nonexistent_dir = tmp_path / "nonexistent" / "nested" / "dir"
    
    lock = McpServerLock(nonexistent_dir)
    lock.acquire()
    
    assert nonexistent_dir.exists()
    assert (nonexistent_dir / LOCK_FILE_NAME).exists()
    
    lock.release()
