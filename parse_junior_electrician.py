import fitz
import re
import os
import json

doc = fitz.open('初級維修電工.pdf')
os.makedirs('data', exist_ok=True)

# 掃描頁手動補入是非題第 13~21 題
P8_SCANNED_QUESTIONS = [
    {
        'id': 'jun_tf_s1_013',
        'num': 13,
        'type': 'tf',
        'question': '在同一變壓器(火牛)供電的中性點接地低壓系統中，不宜一部份設備採用接零保護，另一部份採用接地保護，但同一設備允許採用接零保護後同時又接地。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'O',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_014',
        'num': 14,
        'type': 'tf',
        'question': '電器或線路拆除後，有可能來電的線頭，必須及時用絕緣布包扎好，高壓電動機或電器拆除後，遺留線頭必須短路接地。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'O',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_015',
        'num': 15,
        'type': 'tf',
        'question': '在中性點接地的三相四線制低壓配電網中（即TN型電網），為防止觸電事故的發生，可將電氣設備的外殼接至該網絡中的零線。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'O',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_016',
        'num': 16,
        'type': 'tf',
        'question': '（本題目暫不列入考試範圍內）',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'O',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_017',
        'num': 17,
        'type': 'tf',
        'question': '在必要時（例如離電源較遠），保護接地線與工作零線可用同一根芯線。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'X',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_018',
        'num': 18,
        'type': 'tf',
        'question': '管子佈線的所有導線接頭，應裝設接線盒連接，管子內允許有一個接頭。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'X',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_019',
        'num': 19,
        'type': 'tf',
        'question': '所有穿管線路，管內接頭不得多於1個。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'X',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_020',
        'num': 20,
        'type': 'tf',
        'question': '在潮濕場所安裝金屬導線管時，管路應避免造成U型之低處。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'O',
        'category': '工作規範與電工安全',
        'page': 8
    },
    {
        'id': 'jun_tf_s1_021',
        'num': 21,
        'type': 'tf',
        'question': '電器或線路拆除後，可以不包扎線頭。',
        'options': [{'key': 'O', 'text': '正確 (O)'}, {'key': 'X', 'text': '錯誤 (X)'}],
        'answer': 'X',
        'category': '工作規範與電工安全',
        'page': 8
    }
]

# 是非題各章頁碼 (0-indexed)
tf_sections = [
    (1, '工作規範與電工安全', [6, 8, 9, 10]), # 7, 9, 10, 11 (第8頁由P8_SCANNED_QUESTIONS補充)
    (2, '電工基礎', [12, 13, 14]), # 13, 14, 15
    (3, '電工儀錶測量', [16, 17, 18]), # 17, 18, 19
    (4, '低壓電器、照明與動力', [20, 21, 22, 23]), # 21, 22, 23, 24
    (5, '電機與電氣控制', [25, 26, 27]) # 26, 27, 28
]

def clean_text(t):
    return re.sub(r'\s+', ' ', t).strip()

def parse_tf():
    all_tf = []
    
    for sec_id, sec_name, pages in tf_sections:
        sec_tf = []
        for p_idx in pages:
            page = doc[p_idx]
            page_num = p_idx + 1
            blocks = page.get_text('blocks')
            
            # 答案 (305 <= x0 <= 370)
            ans_list = []
            for b in blocks:
                if 305 <= b[0] <= 370:
                    m = re.search(r'\(\s*([OX0])\s*\)', b[4].strip())
                    if m:
                        a = m.group(1)
                        if a == '0': a = 'O'
                        ans_list.append((a, b[1]))
            ans_list.sort(key=lambda x: x[1])
            
            # 題目塊 (x0 < 70, y0 > 45, y1 < 560, 開頭為數字)
            content_blocks = []
            for b in blocks:
                if b[0] < 330 and 45 < b[1] < 560:
                    txt = b[4].strip()
                    if txt and not any(h in txt for h in ['初 級 維 修 電 工', '職業培訓廳', 'Departamento de Formação', '註：O為正確答案']):
                        content_blocks.append(b)
            content_blocks.sort(key=lambda x: x[1])
            
            # 依照題號開頭分組
            q_groups = []
            current_g = None
            for b in content_blocks:
                txt = b[4].strip()
                # 匹配開頭題號 (例如 "1 ...", "12 ...", "77“...")
                m = re.match(r'^(\d+)(?:[\s\n“\(（]|$)', txt)
                if m and b[0] < 70:
                    if current_g:
                        q_groups.append(current_g)
                    num = int(m.group(1))
                    current_g = {'num': num, 'blocks': [b]}
                else:
                    if current_g:
                        current_g['blocks'].append(b)
            if current_g:
                q_groups.append(current_g)
                
            # 與答案匹配
            for idx, g in enumerate(q_groups):
                full_text = " ".join([b[4].strip() for b in g['blocks']])
                # 清除開頭題號
                full_text = re.sub(r'^\d+[\s\n]*', '', full_text).strip()
                ans = ans_list[idx][0] if idx < len(ans_list) else None
                sec_tf.append({
                    'id': f"jun_tf_s{sec_id}_{g['num']:03d}",
                    'num': g['num'],
                    'type': 'tf',
                    'question': full_text,
                    'options': [
                        {'key': 'O', 'text': '正確 (O)'},
                        {'key': 'X', 'text': '錯誤 (X)'}
                    ],
                    'answer': ans,
                    'category': sec_name,
                    'page': page_num
                })
                
        # 插入第 8 頁手動補入的 9 題
        if sec_id == 1:
            # 題號 1~12 在前，接著插入 13~21，然後是 22~55
            part1 = [q for q in sec_tf if q['num'] <= 12]
            part2 = [q for q in sec_tf if q['num'] >= 22]
            sec_tf = part1 + P8_SCANNED_QUESTIONS + part2
            
        all_tf.extend(sec_tf)
    return all_tf

# 選擇題各章起訖頁 (0-indexed)
mc_sections = [
    (1, '工作規範與電工安全', 29, 53, 100),
    (2, '電工基礎', 55, 82, 110),
    (3, '電工儀錶測量', 84, 96, 50),
    (4, '低壓電器、照明與動力', 98, 122, 100),
    (5, '電機與電氣控制', 124, 136, 50)
]

def parse_mc():
    all_mc = []
    
    for sec_id, sec_name, start_p, end_p, exp_count in mc_sections:
        sec_mc = []
        for p_idx in range(start_p, end_p + 1):
            page = doc[p_idx]
            page_num = p_idx + 1
            blocks = page.get_text('blocks')
            
            # 答案 (305 <= x0 <= 370)
            ans_list = []
            for b in blocks:
                if 305 <= b[0] <= 370:
                    m = re.search(r'\(\s*([ABCD])\s*\)', b[4].strip())
                    if m:
                        ans_list.append((m.group(1), b[1]))
            ans_list.sort(key=lambda x: x[1])
            
            # 內容塊
            content_blocks = []
            for b in blocks:
                if b[0] < 330 and 45 < b[1] < 560:
                    txt = b[4].strip()
                    if txt and not any(h in txt for h in ['初 級 維 修 電 工', '職業培訓廳', 'Departamento de Formação']):
                        content_blocks.append(b)
            content_blocks.sort(key=lambda x: x[1])
            
            # 題號開頭分組
            q_groups = []
            current_g = None
            for b in content_blocks:
                txt = b[4].strip()
                m = re.match(r'^(\d+)(?:[\s\n“\(（]|$)', txt)
                if m and b[0] < 70:
                    if current_g:
                        q_groups.append(current_g)
                    num = int(m.group(1))
                    current_g = {'num': num, 'blocks': [b]}
                else:
                    if current_g:
                        current_g['blocks'].append(b)
            if current_g:
                q_groups.append(current_g)
                
            # 與答案匹配並解析選項
            for idx, g in enumerate(q_groups):
                full_lines = []
                for b in g['blocks']:
                    for line in b[4].splitlines():
                        if line.strip():
                            full_lines.append(line.strip())
                            
                # 去除開頭題號
                if full_lines:
                    full_lines[0] = re.sub(r'^\d+[\s\n]*', '', full_lines[0]).strip()
                    
                # 分離題目與選項
                q_text_lines = []
                options = []
                cur_key = None
                cur_opt_lines = []
                
                for line in full_lines:
                    opt_m = re.match(r'^([A-D])[\.、\s]\s*(.*)$', line)
                    if opt_m:
                        if cur_key:
                            options.append({'key': cur_key, 'text': " ".join(cur_opt_lines).strip()})
                        cur_key = opt_m.group(1)
                        cur_opt_lines = [opt_m.group(2)] if opt_m.group(2) else []
                    else:
                        if cur_key:
                            cur_opt_lines.append(line)
                        else:
                            q_text_lines.append(line)
                if cur_key:
                    options.append({'key': cur_key, 'text': " ".join(cur_opt_lines).strip()})
                    
                ans = ans_list[idx][0] if idx < len(ans_list) else None
                
                sec_mc.append({
                    'id': f"jun_mc_s{sec_id}_{g['num']:03d}",
                    'num': g['num'],
                    'type': 'mc',
                    'question': " ".join(q_text_lines).strip(),
                    'options': options,
                    'answer': ans,
                    'category': sec_name,
                    'section_index': sec_id,
                    'page': page_num
                })
        all_mc.extend(sec_mc)
    return all_mc

print("Extracting Junior Electrician questions...")
tf_qs = parse_tf()
print(f"Extracted TF: {len(tf_qs)} (Expected 200)")

mc_qs = parse_mc()
print(f"Extracted MC: {len(mc_qs)} (Expected 410)")

dataset = {
    'subject_id': 'junior_maintenance_electrician',
    'subject_name': '初級維修電工',
    'title': '初級維修電工 技能測試題庫',
    'source': '澳門特別行政區政府 勞工事務局',
    'total_count': len(tf_qs) + len(mc_qs),
    'tf_count': len(tf_qs),
    'mc_count': len(mc_qs),
    'categories': [
        '工作規範與電工安全',
        '電工基礎',
        '電工儀錶測量',
        '低壓電器、照明與動力',
        '電機與電氣控制'
    ],
    'questions': tf_qs + mc_qs
}

json_path = 'data/junior_maintenance_electrician.json'
with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(dataset, f, ensure_ascii=False, indent=2)

js_path = 'data/junior_maintenance_electrician.js'
with open(js_path, 'w', encoding='utf-8') as f:
    f.write('window.RAW_JUNIOR_ELECTRICIAN_DATA = ' + json.dumps(dataset, ensure_ascii=False) + ';')

print(f"Successfully exported {dataset['total_count']} questions to {json_path} and {js_path}!")
