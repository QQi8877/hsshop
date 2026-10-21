// CSV 匯出／匯入的格式處理（表頭、跳脫、解析）

const CSV_HEADERS=["商品ID(請勿修改)","商品名稱(僅供參考,匯入不會套用)","主分類","子分類","寬cm","深cm","高cm","價格","狀態(上架或封存)"];
function csvEscapeCell(val){
  const s=String(val??"");
  if(/[",\n]/.test(s))return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function csvParseLine(line){
  // 簡易 CSV 解析：支援雙引號包住的欄位、欄位內逗號與跳脫的雙引號
  const cells=[];
  let cur="",inQuotes=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(inQuotes){
      if(ch==='"'){
        if(line[i+1]==='"'){cur+='"';i++}
        else inQuotes=false;
      }else cur+=ch;
    }else{
      if(ch==='"')inQuotes=true;
      else if(ch===","){cells.push(cur);cur=""}
      else cur+=ch;
    }
  }
  cells.push(cur);
  return cells;
}
function parseCSV(text){
  // 拿掉 UTF-8 BOM，統一換行符號後逐行解析
  const clean=text.replace(/^﻿/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const lines=clean.split("\n").filter(l=>l.length>0);
  if(!lines.length)return [];
  const rows=[];
  for(let i=1;i<lines.length;i++){ // 跳過表頭
    const cells=csvParseLine(lines[i]);
    if(!cells.some(c=>c.trim()!==""))continue; // 跳過空行
    rows.push(cells);
  }
  return rows;
}

export{CSV_HEADERS,csvEscapeCell,parseCSV};
