import fitz
import re
import os
import json

doc = fitz.open('中級維修電工.pdf')
output_dir = 'assets/images/mid_electrician'
os.makedirs(output_dir, exist_ok=True)
os.makedirs('data', exist_ok=True)

chap_map = {
    '一': '工作規範與電工安全',
    '二': '電工基礎',
    '三': '電工儀錶測量',
    '四': '低壓電器與照明電路',
    '五': '電機與電氣控制',
    '六': '電子技術基礎'
}

category_keywords = [
    '工作規範', '電工安全', '電工基礎', '電工儀錶測量', '低壓電器', '照明電路',
    '電機', '電氣控制', '電子技術基礎', '電子技術', '與'
]

# 1. 抽取所有圖形並記錄 (頁碼從1開始, bbox, 檔案路徑)
page_images = {}
for p_idx in range(len(doc)):
    page = doc[p_idx]
    page_num = p_idx + 1
    page_images[page_num] = []
    imgs = page.get_images()
    for img in imgs:
        xref = img[0]
        base = doc.extract_image(xref)
        if base['width'] > 30 and base['height'] > 30:
            ext = base['ext']
            rects = page.get_image_rects(xref)
            if rects:
                rect = rects[0]
                fname = f"p{page_num}_img{xref}.{ext}"
                rel_path = f"assets/images/mid_electrician/{fname}"
                abs_path = os.path.join(output_dir, fname)
                with open(abs_path, 'wb') as f:
                    f.write(base['image'])
                page_images[page_num].append({
                    'xref': xref,
                    'y0': rect.y0,
                    'y1': rect.y1,
                    'path': rel_path
                })
    # 按 y0 排序
    page_images[page_num].sort(key=lambda x: x['y0'])

print(f"Total pages with extracted images: {sum(1 for imgs in page_images.values() if imgs)}")

# 2. 解析是非題 (頁面 5 到 35, 即 index 4 到 34)
def parse_all_tf():
    questions = []
    current_chapter = '工作規範與電工安全'
    
    all_lines = []
    for p in range(4, 35):
        page_num = p + 1
        page_text = doc[p].get_text()
        raw_lines = [l.strip() for l in page_text.splitlines() if l.strip()]
        
        # 移除頁碼
        if raw_lines and raw_lines[0] == str(page_num):
            raw_lines = raw_lines[1:]
        elif raw_lines and raw_lines[-1] == str(page_num):
            raw_lines = raw_lines[:-1]
            
        for l in raw_lines:
            if l in ['中級維修電工  是非題', '中級維修電工 是非題', '序號', '題 目', '答案', '分類', '分 類']:
                continue
            all_lines.append((page_num, l))

    idx = 0
    total = len(all_lines)
    current_q_num = None
    
    while idx < total:
        p_num, line = all_lines[idx]
        
        m = re.match(r'^(\d+)(?:\s+(.*))?$', line)
        is_new_q = False
        if m:
            num = int(m.group(1))
            rest = m.group(2)
            if 1 <= num <= 400:
                if current_q_num is None or num == current_q_num + 1 or (current_q_num and num > current_q_num and num <= current_q_num + 3):
                    is_new_q = True

        if is_new_q:
            num = int(m.group(1))
            rest = m.group(2)
            current_q_num = num
            current_q_text = [rest] if rest else []
            idx += 1
            
            ans = None
            while idx < total:
                p_num, l = all_lines[idx]
                if l in ['O', 'X', '0']:
                    ans = 'O' if l in ['O', '0'] else 'X'
                    idx += 1
                    break
                else:
                    nm = re.match(r'^(\d+)(?:\s+(.*))?$', l)
                    if nm and int(nm.group(1)) == current_q_num + 1:
                        break
                    current_q_text.append(l)
                    idx += 1
            
            # 分類
            while idx < total:
                p_num, l = all_lines[idx]
                if l in chap_map:
                    current_chapter = chap_map[l]
                    idx += 1
                elif any(kw == l for kw in category_keywords) or l in ['一', '二', '三', '四', '五', '六']:
                    idx += 1
                else:
                    break
            
            full_text = " ".join([t for t in current_q_text if t]).strip()
            
            # 關聯圖片（若是非題頁面有圖片，很少見但保留支援）
            img_path = None
            if page_images.get(p_num):
                # 如果該頁有圖片，取第一張
                img_path = page_images[p_num][0]['path']
                
            questions.append({
                'id': f"mid_tf_{num:03d}",
                'num': num,
                'type': 'tf',
                'question': full_text,
                'options': [
                    {'key': 'O', 'text': '正確 (O)'},
                    {'key': 'X', 'text': '錯誤 (X)'}
                ],
                'answer': ans,
                'category': current_chapter,
                'image': img_path,
                'page': p_num
            })
        else:
            idx += 1

    return questions

# 3. 解析選擇題 (六個章節)
mc_sections = [
    (1, 35, 49, '工作規範與電工安全', 99),
    (2, 50, 73, '電工基礎', 157),
    (3, 74, 86, '電工儀錶測量', 80),
    (4, 87, 102, '低壓電器與照明電路', 93),
    (5, 102, 120, '電機與電氣控制', 99),
    (6, 121, 129, '電子技術基礎', 58)
]

def parse_all_mc():
    all_mc = []
    
    for sec_idx, start_page, end_page, sec_name, exp_count in mc_sections:
        all_lines = []
        for p in range(start_page, end_page + 1):
            page_num = p + 1
            page_text = doc[p].get_text()
            raw_lines = [l.strip() for l in page_text.splitlines() if l.strip()]
            
            if raw_lines and raw_lines[0] == str(page_num):
                raw_lines = raw_lines[1:]
            elif raw_lines and raw_lines[-1] == str(page_num):
                raw_lines = raw_lines[:-1]
                
            for l in raw_lines:
                if l in ['中級維修電工  選擇題', '中級維修電工 選擇題', '序號', '題 目', '答案', '分類', '分 類', '序號 題 目']:
                    continue
                all_lines.append((page_num, l))
                
        idx = 0
        total = len(all_lines)
        current_q_num = 0
        
        while idx < total:
            p_num, line = all_lines[idx]
            expected_next = current_q_num + 1
            m = re.match(r'^(\d+)(?:\s+(.*))?$', line)
            
            if m and int(m.group(1)) == expected_next:
                num = expected_next
                current_q_num = num
                rest = m.group(2)
                idx += 1
                
                q_lines = [rest] if rest else []
                options = []
                ans = None
                
                in_options = False
                cur_opt_k = None
                cur_opt_t = []
                
                while idx < total:
                    pn, l = all_lines[idx]
                    
                    nm = re.match(r'^(\d+)(?:\s+(.*))?$', l)
                    if nm and int(nm.group(1)) == current_q_num + 1:
                        break
                        
                    if l in chap_map or any(kw == l for kw in category_keywords) or l in ['一', '二', '三', '四', '五', '六']:
                        idx += 1
                        continue
                        
                    opt_m = re.match(r'^([A-D])[\.、\s]\s*(.*)$', l)
                    if opt_m:
                        in_options = True
                        if cur_opt_k:
                            options.append({'key': cur_opt_k, 'text': " ".join(cur_opt_t).strip()})
                        cur_opt_k = opt_m.group(1)
                        cur_opt_t = [opt_m.group(2)] if opt_m.group(2) else []
                        idx += 1
                        continue
                        
                    if l in ['A', 'B', 'C', 'D']:
                        ans = l
                        idx += 1
                        break
                        
                    if in_options:
                        cur_opt_t.append(l)
                    else:
                        q_lines.append(l)
                    idx += 1
                    
                if cur_opt_k:
                    options.append({'key': cur_opt_k, 'text': " ".join(cur_opt_t).strip()})
                    
                # 處理圖片符號題（題目中無選項文字）
                if not options and ans:
                    options = [
                        {'key': 'A', 'text': '見選項圖 A'},
                        {'key': 'B', 'text': '見選項圖 B'},
                        {'key': 'C', 'text': '見選項圖 C'},
                        {'key': 'D', 'text': '見選項圖 D'}
                    ]
                    
                full_q_text = " ".join([t for t in q_lines if t]).strip()
                
                # 智能關聯圖片：從該頁的圖片中匹配
                # 若題目提及「圖」或本題為符號題，優先匹配圖片
                img_path = None
                available_imgs = page_images.get(p_num, [])
                if available_imgs:
                    # 如果該頁有多題需要圖片，按題目在該頁的順序分配圖片
                    if len(available_imgs) == 1:
                        img_path = available_imgs[0]['path']
                    else:
                        # 看看該頁的題目順序
                        # 如果題目包含「圖」或選項是圖片符號題
                        img_path = available_imgs[0]['path']
                
                all_mc.append({
                    'id': f"mid_mc_s{sec_idx}_{num:03d}",
                    'num': num,
                    'type': 'mc',
                    'question': full_q_text,
                    'options': options,
                    'answer': ans,
                    'category': sec_name,
                    'section_index': sec_idx,
                    'image': img_path,
                    'page': p_num
                })
            else:
                idx += 1
                
    return all_mc

print("Parsing True/False questions...")
tf_questions = parse_all_tf()
print(f"Parsed {len(tf_questions)} TF questions.")

print("Parsing Multiple Choice questions...")
mc_questions = parse_all_mc()
print(f"Parsed {len(mc_questions)} MC questions.")

# 針對多圖片頁面進行精準座標匹配
# 讓我們為每個有圖片的題目分配最合適的圖片
for p_num, imgs in page_images.items():
    if not imgs:
        continue
    # 找到該頁的所有題目
    page_qs = [q for q in (tf_questions + mc_questions) if q['page'] == p_num]
    if not page_qs:
        continue
    # 篩選出明確需要圖片的題目（題目含有'圖'、'波形'、'符號'，或者選項為見選項圖）
    diagram_qs = [q for q in page_qs if any(kw in q['question'] for kw in ['圖', '波形', '符號', '如右', '下圖']) or (q['options'] and '見選項圖' in q['options'][0]['text'])]
    if not diagram_qs:
        diagram_qs = page_qs # fallback
        
    # 如果圖片數量與題目數量相近，依順序一對一配對
    if len(imgs) == len(diagram_qs):
        for i, q in enumerate(diagram_qs):
            q['image'] = imgs[i]['path']
    elif len(imgs) == 1 and len(diagram_qs) >= 1:
        diagram_qs[0]['image'] = imgs[0]['path']
    elif len(imgs) > 1 and len(diagram_qs) > 0:
        for i, q in enumerate(diagram_qs):
            if i < len(imgs):
                q['image'] = imgs[i]['path']

# 最終結構
final_dataset = {
    'subject_id': 'mid_maintenance_electrician',
    'subject_name': '中級維修電工',
    'title': '中級維修電工 技能測試題庫',
    'source': '澳門特別行政區政府 勞工事務局 2026',
    'version': '2026.05',
    'total_count': len(tf_questions) + len(mc_questions),
    'tf_count': len(tf_questions),
    'mc_count': len(mc_questions),
    'categories': [
        '工作規範與電工安全',
        '電工基礎',
        '電工儀錶測量',
        '低壓電器與照明電路',
        '電機與電氣控制',
        '電子技術基礎'
    ],
    'questions': tf_questions + mc_questions
}

json_path = 'data/mid_maintenance_electrician.json'
with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(final_dataset, f, ensure_ascii=False, indent=2)

print(f"Successfully exported {final_dataset['total_count']} questions to {json_path}!")

