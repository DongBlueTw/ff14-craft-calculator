import urllib.request
import json
import os
import sys
import msgpack

# ─── 設定 ──────────────────────────────────────────────────────────────────
RECIPES_URL = "https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/recipes.json"
ITEMS_TW_URL = "https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/tw/tw-items.json"

DATA_DIR = "data"
RECIPES_OUT = os.path.join(DATA_DIR, "recipes.msgpack")
ITEMS_TW_OUT = os.path.join(DATA_DIR, "items-tw.msgpack")

# 強制輸出為 UTF-8
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

def download_json(url, name):
    print(f"正在從 Teamcraft 下載最新的 {name} 資料...")
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            content = response.read()
            print(f"下載完成！共 {len(content) / (1024*1024):.2f} MB。正在解析 JSON...")
            return json.loads(content.decode('utf-8'))
    except Exception as e:
        print(f"下載或解析 {name} 失敗: {e}")
        sys.exit(1)

def to_int_or_str(val):
    try:
        return int(val)
    except (ValueError, TypeError):
        return val

def process_recipes(recipes_raw):
    print("正在對配方資料庫進行瘦身處理...")
    processed = []
    
    for r in recipes_raw:
        if not r or 'result' not in r:
            continue
        
        # 建立瘦身版配方物件
        recipe_slim = {
            "id": to_int_or_str(r["id"]),
            "res": to_int_or_str(r["result"]),
            "yld": to_int_or_str(r.get("yields", 1))
        }
        
        # 材料清單瘦身
        ingredients_slim = []
        for ing in r.get("ingredients", []):
            ingredients_slim.append({
                "id": to_int_or_str(ing["id"]),
                "amt": to_int_or_str(ing["amount"])
            })
        
        recipe_slim["ing"] = ingredients_slim
        processed.append(recipe_slim)
        
    print(f"配方瘦身完成！共處理 {len(processed)} 筆配方。")
    return processed

def process_items(items_raw):
    print("正在對繁中道具名稱進行簡化處理...")
    processed = {}
    
    for k, v in items_raw.items():
        if isinstance(v, dict) and "tw" in v:
            # 簡化為： 物品ID -> 繁中名稱
            processed[str(k)] = v["tw"]
        elif isinstance(v, str):
            processed[str(k)] = v
            
    print(f"道具名稱簡化完成！共處理 {len(processed)} 筆道具。")
    return processed

def main():
    # 確保資料夾存在
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        print(f"已建立資料夾: {DATA_DIR}")

    # 1. 下載與處理配方
    recipes_raw = download_json(RECIPES_URL, "配方 (Recipes)")
    recipes_processed = process_recipes(recipes_raw)
    
    # 2. 下載與處理道具
    items_raw = download_json(ITEMS_TW_URL, "繁中道具 (Items-TW)")
    items_processed = process_items(items_raw)
    
    # 3. MessagePack 打包
    print(f"正在打包並寫入 {RECIPES_OUT}...")
    with open(RECIPES_OUT, "wb") as f:
        f.write(msgpack.packb(recipes_processed))
        
    print(f"正在打包並寫入 {ITEMS_TW_OUT}...")
    with open(ITEMS_TW_OUT, "wb") as f:
        f.write(msgpack.packb(items_processed))
        
    print("\n🎉 所有資料庫抓取、瘦身、壓縮並更新完成！")
    print(f"└─ 配方檔案大小: {os.path.getsize(RECIPES_OUT) / 1024:.1f} KB")
    print(f"└─ 道具檔案大小: {os.path.getsize(ITEMS_TW_OUT) / 1024:.1f} KB")

if __name__ == "__main__":
    main()
