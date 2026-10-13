"""標題字型瘦身：只留網站真的用到的字。

fonts/noto-serif-tc-{400,500,600}.woff2 是完整的繁體中文常用字（每個約 1.3MB，三個字重將近 4MB），
但網站標題、商品名稱、分類名稱實際只用到幾百個字。這支程式依照 build-pages.mjs 算好的
fonts/heading-chars.txt（網站上所有標題可能出現的字），從完整字型裡只取出這些字，另存成
fonts/noto-serif-tc-{400,500,600}-sub.woff2（每個約一兩百 KB），前台先載入這三個小檔案。

字單裡的字沒變，就不重做（輸出檔一模一樣，不會每小時多一筆更新）。後台新增的商品名稱用到
新的字：前台會自動改抓完整字型補那幾個字（見 index.html 的字型說明），下一次每小時更新就會補進小檔案。

用法：python3 _tools/subset-fonts.py [輸出資料夾，預設是網站根目錄]
需要：pip install fonttools brotli（版本見 .github/workflows/build-pages.yml）
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
WEIGHTS = (400, 500, 600)


def cmap_of(font):
    return set(font.getBestCmap().keys())


def main():
    chars_file = OUT / "fonts" / "heading-chars.txt"
    wanted = {ord(c) for c in chars_file.read_text(encoding="utf-8") if c not in "\r\n"}
    for w in WEIGHTS:
        src = ROOT / "fonts" / f"noto-serif-tc-{w}.woff2"
        dst = OUT / "fonts" / f"noto-serif-tc-{w}-sub.woff2"
        # recalcTimestamp=False：字一樣，輸出的檔案就一模一樣
        full = TTFont(src, recalcTimestamp=False)
        target = wanted & cmap_of(full)
        if dst.exists() and cmap_of(TTFont(dst)) == target:
            continue
        opts = Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]   # 保留字距、直式標點等排版資訊
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        sub = Subsetter(options=opts)
        sub.populate(unicodes=target)
        sub.subset(full)
        full.flavor = "woff2"
        dst.parent.mkdir(parents=True, exist_ok=True)
        full.save(dst)
        print(f"{dst.name}: {len(target)} 字，{dst.stat().st_size // 1024} KB（完整字型 {src.stat().st_size // 1024} KB）")


main()
