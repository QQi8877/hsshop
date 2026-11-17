import sys,os,re
a,b=sys.argv[1],sys.argv[2]
def norm(t):
    # 標籤裡的屬性排序後再比（屬性順序不影響瀏覽器）
    def f(m):
        attrs=re.findall(r'\s([^\s=>]+(?:="[^"]*")?)',m.group(2) or "")
        return "<"+m.group(1)+"".join(" "+x for x in sorted(attrs))+">"
    return re.sub(r'<([a-zA-Z][\w-]*)(\s[^>]*)?>',f,t)
same=attr_only=0;diff=[]
files=sorted(set(os.path.relpath(os.path.join(r,f),a) for r,_,fs in os.walk(a) for f in fs)|set(os.path.relpath(os.path.join(r,f),b) for r,_,fs in os.walk(b) for f in fs))
for f in files:
    pa,pb=os.path.join(a,f),os.path.join(b,f)
    if not(os.path.exists(pa) and os.path.exists(pb)):diff.append(f+" (missing)");continue
    x,y=open(pa,encoding='utf8',errors='replace').read(),open(pb,encoding='utf8',errors='replace').read()
    if x==y:same+=1
    elif norm(x)==norm(y):attr_only+=1
    else:diff.append(f)
print(f"{len(files)} files: {same} identical, {attr_only} differ only in attribute order, {len(diff)} really differ")
for f in diff[:8]:print("  ",f)
