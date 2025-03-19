#!/usr/bin/env python3
"""
ISO 27001 compliant backup script for Web Scraping Application
"""

import os
import shutil
import datetime
import logging
import hashlib
import json
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/web_scraper_backup.log'),
        logging.StreamHandler()
    ]
)

def create_backup():
    """Create a backup of the application data."""
    try:
        # Create timestamp for backup
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"web_scraper_backup_{timestamp}"
        backup_dir = Path('backups') / backup_name
        
        # Create backup directory
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Backup files and directories
        items_to_backup = [
            'article_cache.json',
            'config.py',
            'logs',
            'data'
        ]
        
        for item in items_to_backup:
            if os.path.exists(item):
                if os.path.isdir(item):
                    shutil.copytree(item, backup_dir / item)
                else:
                    shutil.copy2(item, backup_dir)
        
        # Create checksum file
        create_checksum(backup_dir)
        
        # Create backup manifest
        create_manifest(backup_dir)
        
        logging.info(f"Backup completed successfully: {backup_name}")
        return True
        
    except Exception as e:
        logging.error(f"Backup failed: {str(e)}")
        return False

def create_checksum(backup_dir):
    """Create checksums for all files in backup."""
    checksums = {}
    
    for root, _, files in os.walk(backup_dir):
        for file in files:
            if file not in ['checksums.json', 'manifest.json']:
                file_path = os.path.join(root, file)
                with open(file_path, 'rb') as f:
                    checksums[file_path] = hashlib.sha256(f.read()).hexdigest()
    
    with open(backup_dir / 'checksums.json', 'w') as f:
        json.dump(checksums, f, indent=2)

def create_manifest(backup_dir):
    """Create backup manifest with metadata."""
    manifest = {
        'timestamp': datetime.datetime.now().isoformat(),
        'version': '1.0',
        'files': []
    }
    
    for root, _, files in os.walk(backup_dir):
        for file in files:
            if file not in ['checksums.json', 'manifest.json']:
                file_path = os.path.join(root, file)
                manifest['files'].append({
                    'path': file_path,
                    'size': os.path.getsize(file_path),
                    'modified': datetime.datetime.fromtimestamp(
                        os.path.getmtime(file_path)
                    ).isoformat()
                })
    
    with open(backup_dir / 'manifest.json', 'w') as f:
        json.dump(manifest, f, indent=2)

def verify_backup(backup_dir):
    """Verify backup integrity using checksums."""
    try:
        with open(backup_dir / 'checksums.json', 'r') as f:
            checksums = json.load(f)
        
        for file_path, expected_hash in checksums.items():
            with open(file_path, 'rb') as f:
                actual_hash = hashlib.sha256(f.read()).hexdigest()
            
            if actual_hash != expected_hash:
                logging.error(f"Checksum mismatch for {file_path}")
                return False
        
        logging.info("Backup verification completed successfully")
        return True
        
    except Exception as e:
        logging.error(f"Backup verification failed: {str(e)}")
        return False

def cleanup_old_backups(max_backups=5):
    """Remove old backups keeping only the most recent ones."""
    try:
        backup_dir = Path('backups')
        if not backup_dir.exists():
            return
        
        backups = sorted(
            [d for d in backup_dir.iterdir() if d.is_dir()],
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        
        for old_backup in backups[max_backups:]:
            shutil.rmtree(old_backup)
            logging.info(f"Removed old backup: {old_backup}")
            
    except Exception as e:
        logging.error(f"Cleanup failed: {str(e)}")

if __name__ == "__main__":
    if create_backup():
        backup_dir = Path('backups')
        latest_backup = max(
            [d for d in backup_dir.iterdir() if d.is_dir()],
            key=lambda x: x.stat().st_mtime
        )
        if verify_backup(latest_backup):
            cleanup_old_backups()
        else:
            logging.error("Backup verification failed") 