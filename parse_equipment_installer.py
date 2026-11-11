import fitz
import re
import os
import json

doc = fitz.open('初級設備安裝工.pdf')
os.makedirs('data', exist_ok=True)

# 是非題各章起訖頁 (0-indexed)
tf_sections = [
    (1, '工作規範與電工安全', [6, 7, 8, 9], 50),     # PDF 7, 8, 9, 10
    (2, '鉗工基礎', [11, 12], 30),                     # PDF 12, 13
    (3, '電工基礎', [14, 15, 16], 40),                 # PDF 15, 16, 17
    (4, '安裝技能', [18, 19, 20], 30)                  # PDF 19, 20, 21
]

def clean_text(t):
    return re.sub(r'\s+', ' ', t).strip()

def parse_tf():
    all_tf = []
    
    for sec_id, sec_name, pages, exp_count in tf_sections:
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
            
            # 內容塊
            content_blocks = []
            for b in blocks:
                if b[0] < 330 and 45 < b[1] < 560:
                    txt = b[4].strip()
                    if txt and not any(h in txt for h in ['初 級 電 氣 設 備 安 裝 工', '職業培訓廳', 'Departamento de Formação', '註：O為正確答案']):
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
                
            for idx, g in enumerate(q_groups):
                full_text = " ".join([b[4].strip() for b in g['blocks']])
                full_text = re.sub(r'^\d+[\s\n]*', '', full_text).strip()
                ans = ans_list[idx][0] if idx < len(ans_list) else None
                sec_tf.append({
                    'id': f"eq_tf_s{sec_id}_{g['num']:03d}",
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
        all_tf.extend(sec_tf)
    return all_tf

# 選擇題各章起訖頁 (0-indexed)
mc_sections = [
    (1, '工作規範與電工安全', 22, 38, 67),  # PDF 23 ~ 39
    (2, '鉗工基礎', 40, 44, 20),              # PDF 41 ~ 45
    (3, '電工基礎', 46, 58, 50),              # PDF 47 ~ 59
    (4, '安裝技能', 60, 69, 41)               # PDF 61 ~ 70
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
                    if txt and not any(h in txt for h in ['初 級 電 氣 設 備 安 裝 工', '職業培訓廳', 'Departamento de Formação']):
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
                
            for idx, g in enumerate(q_groups):
                full_lines = []
                for b in g['blocks']:
                    for line in b[4].splitlines():
                        if line.strip():
                            full_lines.append(line.strip())
                            
                if full_lines:
                    full_lines[0] = re.sub(r'^\d+[\s\n]*', '', full_lines[0]).strip()
                    
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
                    'id': f"eq_mc_s{sec_id}_{g['num']:03d}",
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

print("Extracting Equipment Installer questions...")
tf_qs = parse_tf()
print(f"Extracted TF: {len(tf_qs)} (Expected 150)")

mc_qs = parse_mc()
print(f"Extracted MC: {len(mc_qs)} (Expected 178)")

dataset = {
    'subject_id': 'junior_equipment_installer',
    'subject_name': '初級電氣設備安裝工',
    'title': '初級電氣設備安裝工 技能測試題庫',
    'source': '澳門特別行政區政府 勞工事務局',
    'total_count': len(tf_qs) + len(mc_qs),
    'tf_count': len(tf_qs),
    'mc_count': len(mc_qs),
    'categories': [
        '工作規範與電工安全',
        '鉗工基礎',
        '電工基礎',
        '安裝技能'
    ],
    'questions': tf_qs + mc_qs
}

json_path = 'data/junior_equipment_installer.json'
with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(dataset, f, ensure_ascii=False, indent=2)

js_path = 'data/junior_equipment_installer.js'
with open(js_path, 'w', encoding='utf-8') as f:
    f.write('window.RAW_EQUIPMENT_INSTALLER_DATA = ' + json.dumps(dataset, ensure_ascii=False) + ';')

print(f"Successfully exported {dataset['total_count']} questions to {json_path} and {js_path}!")
