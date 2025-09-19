import random
from collections import defaultdict
from itertools import combinations
import os
import json
import uuid
from datetime import datetime

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
app = Flask(__name__)

CORS(app)  # 允许所有域名访问

HISTORY_FILE = 'history.json'

def read_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []

def write_history(data):
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


def get_possible_k(num_players, mode, num_males=0, num_females=0):
    """计算每人可能的对局数 (k)"""
    if num_players < 4:
        return []

    options = []
    # 将k的上限提高到20
    max_k = 20
    if mode == 'mixed':
        if num_males < 2 or num_females < 2:
            return []
        # 对于混双，每场比赛需要2男2女
        # 总比赛场数 * 2 = 男队员数 * k
        # k 必须是能使 (num_males * k) / 2 为整数的数
        for k in range(1, max_k + 1):
            if (num_males * k) % 2 == 0 and (num_females * k) % 2 == 0:
                options.append(k)
    else:  # random_doubles
        # 对于随机双打，每场比赛需要4人
        # 总比赛场数 * 4 = 总人数 * k
        # k 必须是能使 (num_players * k) % 4 为整数的数
        for k in range(1, max_k + 1):
            if (num_players * k) % 4 == 0:
                options.append(k)
    return options


def generate_random_doubles(players, k):
    """生成随机双打对阵，优化搭档公平性"""
    num_players = len(players)
    total_matches = (num_players * k) // 4

    games_played = defaultdict(int)
    partnerships = defaultdict(lambda: defaultdict(int))
    matches = []

    all_possible_pairs = list(combinations(players, 2))

    while len(matches) < total_matches:
        available_players = [p for p in players if games_played[p['name']] < k]
        if len(available_players) < 4:
            break

        scored_pairs = []
        for p1, p2 in combinations(available_players, 2):
            score = partnerships[p1['name']][p2['name']]
            scored_pairs.append(((p1, p2), score))
        
        scored_pairs.sort(key=lambda x: x[1])

        best_match_found = None
        lowest_total_score = float('inf')

        # 遍历所有可能的配对组合，找到最优的比赛
        # This is O(N^4) in the number of available_players, but should be fast enough for typical group sizes.
        for i in range(len(scored_pairs)):
            pair1, score1 = scored_pairs[i]
            p1, p2 = pair1
            
            # 为了效率，如果当前单队的得分已经高于记录，则跳过
            if score1 >= lowest_total_score:
                continue

            for j in range(i + 1, len(scored_pairs)):
                pair2, score2 = scored_pairs[j]
                p3, p4 = pair2

                # 检查两队是否有重合的队员
                if p1 not in pair2 and p2 not in pair2:
                    current_total_score = score1 + score2
                    if current_total_score < lowest_total_score:
                        lowest_total_score = current_total_score
                        best_match_found = (pair1, pair2)
                        # 如果找到了一个得分为0的完美匹配，就没必要继续搜索了
                        if lowest_total_score == 0:
                            break
            if lowest_total_score == 0:
                break
        
        if best_match_found:
            (p1, p2), (p3, p4) = best_match_found
            
            # 随机分配队伍
            if random.random() < 0.5:
                match = {'team1': [p1['name'], p2['name']], 'team2': [p3['name'], p4['name']]}
            else:
                match = {'team1': [p3['name'], p4['name']], 'team2': [p1['name'], p2['name']]}
            matches.append(match)

            # 更新统计数据
            for p in [p1, p2, p3, p4]:
                games_played[p['name']] += 1
            partnerships[p1['name']][p2['name']] += 1
            partnerships[p2['name']][p1['name']] += 1
            partnerships[p3['name']][p4['name']] += 1
            partnerships[p4['name']][p3['name']] += 1
        else:
            # 如果找不到可行的比赛（例如，只剩下无法组成不相交配对的选手），则终止
            break
            
    return matches


def generate_mixed_doubles(players, k):
    """生成男女混双对阵"""
    males = [p for p in players if p['gender'] == 'M']
    females = [p for p in players if p['gender'] == 'F']

    num_males = len(males)
    num_females = len(females)

    if num_males < 2 or num_females < 2:
        raise ValueError("男女队员人数必须都至少为2人才能进行混双比赛。")

    total_matches = (num_males * k) // 2 # 假设以男队员为基准

    games_played = defaultdict(int)
    partnerships = defaultdict(lambda: defaultdict(int))
    matches = []
    
    max_attempts = total_matches * 5

    while len(matches) < total_matches and max_attempts > 0:
        max_attempts -= 1
        
        eligible_males = sorted([p for p in males if games_played[p['name']] < k], key=lambda p: games_played[p['name']])
        eligible_females = sorted([p for p in females if games_played[p['name']] < k], key=lambda p: games_played[p['name']])

        if len(eligible_males) < 2 or len(eligible_females) < 2:
            break

        m1, m2 = random.sample(eligible_males, 2)
        f1, f2 = random.sample(eligible_females, 2)

        # 两种组合方式
        # (m1, f1) vs (m2, f2) or (m1, f2) vs (m2, f1)
        score1 = partnerships[m1['name']][f1['name']] + partnerships[m2['name']][f2['name']]
        score2 = partnerships[m1['name']][f2['name']] + partnerships[m2['name']][f1['name']]

        if score1 < score2:
            match = {'team1': [m1['name'], f1['name']], 'team2': [m2['name'], f2['name']]}
            partnerships[m1['name']][f1['name']] += 1
            partnerships[f1['name']][m1['name']] += 1
            partnerships[m2['name']][f2['name']] += 1
            partnerships[f2['name']][m2['name']] += 1
        elif score2 < score1:
            match = {'team1': [m1['name'], f2['name']], 'team2': [m2['name'], f1['name']]}
            partnerships[m1['name']][f2['name']] += 1
            partnerships[f2['name']][m1['name']] += 1
            partnerships[m2['name']][f1['name']] += 1
            partnerships[f1['name']][m2['name']] += 1
        else: # 分数相同时随机选择
            if random.random() < 0.5:
                match = {'team1': [m1['name'], f1['name']], 'team2': [m2['name'], f2['name']]}
                partnerships[m1['name']][f1['name']] += 1
                partnerships[f1['name']][m1['name']] += 1
                partnerships[m2['name']][f2['name']] += 1
                partnerships[f2['name']][m2['name']] += 1
            else:
                match = {'team1': [m1['name'], f2['name']], 'team2': [m2['name'], f1['name']]}
                partnerships[m1['name']][f2['name']] += 1
                partnerships[f2['name']][m1['name']] += 1
                partnerships[m2['name']][f1['name']] += 1
                partnerships[f1['name']][m2['name']] += 1
        
        matches.append(match)
        for p in [m1, m2, f1, f2]:
            games_played[p['name']] += 1
            
    return matches


@app.route('/')
def index():
    history = read_history()
    history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    # 为历史记录创建更具描述性的标题
    for item in history:
        if 'players' in item and item['players']:
            item['title'] = f"{item['timestamp']} - {len(item['players'])}人局"
        else:
            item['title'] = item['timestamp']
    return render_template('index.html', history_list=history)


@app.route('/get_k_options', methods=['POST'])
def get_k_options_route():
    data = request.get_json()
    players = data.get('players', [])
    mode = data.get('mode')
    
    num_players = len(players)
    num_males = sum(1 for p in players if p['gender'] == 'M')
    num_females = sum(1 for p in players if p['gender'] == 'F')

    options = get_possible_k(num_players, mode, num_males, num_females)
    return jsonify(options)


@app.route('/generate', methods=['POST'])
def generate():
    players = []
    i = 0
    while f'player-name-{i}' in request.form:
        name = request.form[f'player-name-{i}']
        gender = request.form[f'player-gender-{i}']
        if name:
            players.append({'name': name, 'gender': gender})
        i += 1

    mode = request.form['mode']
    k = int(request.form['k'])

    if len(players) < 6:
        return render_template('result.html', error="队员人数必须至少为6人。")

    try:
        if mode == 'mixed':
            num_males = sum(1 for p in players if p['gender'] == 'M')
            num_females = len(players) - num_males
            if num_males < 2 or num_females < 2:
                 return render_template('result.html', error="混双模式下，男女队员至少各需要2名。")
            matches = generate_mixed_doubles(players, k)
        else:
            matches = generate_random_doubles(players, k)
        # 将队员列表传递给结果页面
        return render_template('result.html', matches=matches, history_id=None, players=players)
    except ValueError as e:
        return render_template('result.html', error=str(e))


@app.route('/save_history', methods=['POST'])
def save_history():
    data = request.get_json()
    matches = data.get('matches')
    players = data.get('players') # 获取队员列表
    if not matches or not players:
        return jsonify({'status': 'error', 'message': '缺少比赛或队员数据'}), 400

    history = read_history()
    
    new_history_entry = {
        'id': str(uuid.uuid4()),
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'matches': matches,
        'players': players # 保存队员列表
    }

    history.append(new_history_entry)
    write_history(history)
    
    return jsonify({'status': 'success', 'history_id': new_history_entry['id']})


@app.route('/history/<history_id>')
def view_history(history_id):
    history = read_history()
    match_data = next((item for item in history if item['id'] == history_id), None)
    
    if not match_data:
        return render_template('result.html', error="找不到指定的历史记录。")

    # 从历史记录中加载队员列表并传递
    return render_template('result.html', matches=match_data['matches'], history_id=history_id, players=match_data.get('players', []))


@app.route('/update_history/<history_id>', methods=['POST'])
def update_history(history_id):
    data = request.get_json()
    updated_matches = data.get('matches')
    players = data.get('players') # 获取队员列表
    if not updated_matches or not players:
        return jsonify({'status': 'error', 'message': '缺少比赛或队员数据'}), 400

    history = read_history()
    history_entry = next((item for item in history if item['id'] == history_id), None)

    if not history_entry:
        return jsonify({'status': 'error', 'message': 'History not found'}), 404

    history_entry['matches'] = updated_matches
    history_entry['players'] = players # 更新队员列表
    history_entry['timestamp'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S (已编辑)')
    
    write_history(history)
    return jsonify({'status': 'success'})


if __name__ == '__main__':
    app.run(debug=True, port=5001)