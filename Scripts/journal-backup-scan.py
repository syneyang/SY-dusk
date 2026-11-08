#!/usr/bin/env python3
"""扫描 Mac 上的 iPhone 备份，看看能不能找到「手记」的数据。

用法：
    python3 Scripts/journal-backup-scan.py

只读，不改任何东西。找不到就说明这台 Mac 上没有备份，或者备份不含手记。
"""
import os
import plistlib
import sqlite3
from pathlib import Path

BACKUP_ROOT = Path.home() / "Library/Application Support/MobileSync/Backup"


def human(size: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"


def find_backups():
    if not BACKUP_ROOT.exists():
        return []
    return [p for p in BACKUP_ROOT.iterdir() if p.is_dir()]


def read_manifest(backup: Path):
    info = backup / "Info.plist"
    if not info.exists():
        return {}
    try:
        with info.open("rb") as fh:
            return plistlib.load(fh)
    except Exception as error:  # noqa: BLE001
        return {"__error__": str(error)}


def scan_domains(backup: Path):
    manifest = backup / "Manifest.db"
    if not manifest.exists():
        print("  ! 没有 Manifest.db（备份可能不完整）")
        return
    try:
        conn = sqlite3.connect(f"file:{manifest}?mode=ro", uri=True)
    except sqlite3.Error as error:
        print(f"  ! 打不开 Manifest.db：{error}")
        return

    rows = conn.execute(
        "select domain, relativePath, fileID, length(file) from Files "
        "where domain like '%Journal%' or relativePath like '%Journal%'"
    ).fetchall()
    conn.close()

    if not rows:
        print("  · 备份里没有 Journal 相关的文件")
        return

    total = 0
    sqlite_files = []
    for domain, relative, file_id, _size in rows:
        path = backup / file_id[:2] / file_id
        size = path.stat().st_size if path.exists() else 0
        total += size
        print(f"  {human(size):>9}  {domain}/{relative}")
        if relative.endswith(".sqlite") or relative.endswith(".db") or relative.endswith(".sqlite3"):
            sqlite_files.append((path, relative))

    print(f"  ---- 合计 {human(total)}，{len(rows)} 个文件 ----")

    for path, name in sqlite_files:
        print(f"\n  == 表结构：{name} ==")
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            tables = [r[0] for r in conn.execute(
                "select name from sqlite_master where type='table' order by name"
            )]
            for table in tables:
                try:
                    count = conn.execute(f'select count(*) from "{table}"').fetchone()[0]
                except sqlite3.Error:
                    count = "?"
                print(f"    {table:<32} {count}")
            conn.close()
        except sqlite3.Error as error:
            print(f"    ! 读不了：{error}")


def main() -> None:
    backups = find_backups()
    if not backups:
        print(f"没找到备份目录：{BACKUP_ROOT}")
        print("先在 Finder 里把 iPhone 备份到这台 Mac，再跑一次。")
        return

    for backup in backups:
        info = read_manifest(backup)
        name = info.get("Device Name", "?")
        ios = info.get("Product Version", "?")
        encrypted = info.get("IsEncrypted")
        date = info.get("Last Backup Date")
        print(f"\n=== 备份：{name} · iOS {ios} ===")
        print(f"    目录：{backup.name}")
        print(f"    加密：{'是（读不了，需要先在 Finder 里关掉加密重新备份）' if encrypted else '否'}")
        print(f"    时间：{date}")
        if info.get("__error__"):
            print(f"    ! Info.plist 读取失败：{info['__error__']}")
        if not encrypted:
            scan_domains(backup)


if __name__ == "__main__":
    main()
