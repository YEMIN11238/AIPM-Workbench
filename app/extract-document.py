"""Text extraction for user-selected PRDs; document content is never executed."""
import sys
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
p = Path(sys.argv[1])
if p.stat().st_size > 20_000_000:
    raise ValueError('文件超过20MB')
if p.suffix.lower() == '.pdf':
    from pypdf import PdfReader
    text = '\n'.join(page.extract_text() or '' for page in PdfReader(p).pages)
elif p.suffix.lower() == '.docx':
    with zipfile.ZipFile(p) as z:
        info = z.getinfo('word/document.xml')
        if info.file_size > 5_000_000:
            raise ValueError('Word内容超过限制')
        text = '\n'.join(ET.fromstring(z.read(info)).itertext())
else:
    text = p.read_text()
print(text[:100000])
