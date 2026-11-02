"""Extract user-selected research materials without executing their contents."""
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

path = Path(sys.argv[1])
if path.stat().st_size > 20_000_000:
    raise ValueError("资料超过20MB，请选择相关章节")
suffix = path.suffix.lower()
if suffix == ".pdf":
    from pypdf import PdfReader
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError("PDF已加密，请先提供可读取的副本")
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
elif suffix == ".docx":
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo("word/document.xml")
        if info.file_size > 10_000_000:
            raise ValueError("Word正文过大，请选择相关章节")
        root = ET.fromstring(archive.read(info))
        text = "\n".join("".join(node.itertext()) for node in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"))
elif suffix in {".md", ".txt", ".csv", ".json"}:
    text = path.read_text(encoding="utf-8-sig")
else:
    raise ValueError("不支持此资料格式")
if not text.strip():
    raise ValueError("未读到正文；扫描PDF请提供文字版或相关页面截图")
if len(text) > 400_000:
    raise ValueError("资料超过40万字，请拆分为相关章节；未截断或导入")
sys.stdout.write(text)
