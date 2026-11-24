"""字型瘦身：只留網站真的用到的字。

fonts/ 裡的完整字型是繁體中文常用字（每個字重約 1～1.3MB），但網站實際只用到幾百個字。這支程式照
build-pages.mjs 算好的字單，從完整字型裡只取出這些字，另存成小檔案（每個約一百 KB），前台只載入小檔案：
- 明體（店名、首頁大標）：fonts/heading-chars.txt → fonts/noto-serif-tc-{400,500,600}-sub.woff2
- 思源黑體（全站其他的字）：fonts/site-chars.txt → fonts/noto-sans-tc-{400,500,600}-sub.woff2

字單裡的字沒變，就不重做（輸出檔一模一樣，不會每小時多一筆更新）。後台新增的商品用到新的字：
明體會自動改抓完整字型補那幾個字，黑體先用裝置內建的字顯示（見 index.html 的字型說明），
下一次每小時更新就會補進小檔案。全形標點（，（）！？…）不在完整字型裡，另外放在 *-punct.woff2，不用每小時重做。

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
JOBS = (("noto-serif-tc", "heading-chars.txt"), ("noto-sans-tc", "site-chars.txt"))


def cmap_of(font):
    return set(font.getBestCmap().keys())


def main():
    for name, chars_name in JOBS:
        chars_file = OUT / "fonts" / chars_name
        if not chars_file.exists():
            print(f"沒有 {chars_name}，跳過 {name}")
            continue
        wanted = {ord(c) for c in chars_file.read_text(encoding="utf-8") if c not in "\r\n"}
        for w in WEIGHTS:
            src = ROOT / "fonts" / f"{name}-{w}.woff2"
            dst = OUT / "fonts" / f"{name}-{w}-sub.woff2"
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
