import random
from collections import defaultdict
from itertools import combinations
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import uuid
import redis
from datetime import datetime

# Vercel 会将这个 'app' 变量作为应用实例
app = Flask(__name__)
CORS(app) # 允许所有来源的跨域请求

# --- Redis 连接 (Python 版本) ---
# 从 Vercel 环境变量获取 Redis 连接信息
redis_url = os.environ.get('homurajiang_badminton_REDIS_URL')
if not redis_url:
    raise ValueError("Redis URL 环境变量未设置，请在 Vercel 控制台配置")

# 初始化 Redis 客户端
try:
    db = redis.from_url(redis_url, decode_responses=True)
    # 测试连接
    db.ping()
    app.logger.info("Redis 连接成功")
except Exception as e:
    app.logger.error(f"Redis 连接失败: {str(e)}")
    raise

# --- 核心算法代码保持不变 ---
def get_possible_k(num_players, mode, num_males=0, num_females=0):
    options = []
    max_k = 20
    if mode == 'mixed':
        if num_males < 2 or num_females < 2:
            return []
        for k in range(1, max_k + 1):
            if (num_males * k) % 2 == 0 and (num_females * k) % 2 == 0:
                options.append(k)
    elif mode == 'singles_robin':
        if num_players < 2:
            return []
        round_robin_games = num_players - 1
        if round_robin_games > 0:
            k = round_robin_games
            while k <= max_k:
                options.append(k)
                k += round_robin_games
    else: # 'random_doubles'
        if num_players < 4:
            return []
        for k in range(1, max_k + 1):
            if (num_players * k) % 4 == 0:
                options.append(k)
    return options

def generate_random_doubles(players, k):
    num_players = len(players)
    total_matches = (num_players * k) // 4
    games_played = defaultdict(int)
    partnerships = defaultdict(lambda: defaultdict(int))
    matches = []
    while len(matches) < total_matches:
        available_players = [p for p in players if games_played[p['name']] < k]
        if len(available_players) < 4: break
        scored_pairs = []
        for p1, p2 in combinations(available_players, 2):
            score = partnerships[p1['name']][p2['name']]
            scored_pairs.append(((p1, p2), score))
        scored_pairs.sort(key=lambda x: x[1])
        best_match_found = None
        lowest_total_score = float('inf')
        for i in range(len(scored_pairs)):
            pair1, score1 = scored_pairs[i]
            if score1 >= lowest_total_score: continue
            for j in range(i + 1, len(scored_pairs)):
                pair2, score2 = scored_pairs[j]
                p3, p4 = pair2
                if p1 not in pair2 and p2 not in pair2:
                    current_total_score = score1 + score2
                    if current_total_score < lowest_total_score:
                        lowest_total_score = current_total_score
                        best_match_found = (pair1, pair2)
                        if lowest_total_score == 0: break
            if lowest_total_score == 0: break
        if best_match_found:
            (p1, p2), (p3, p4) = best_match_found
            match = {'team1': [p1['name'], p2['name']], 'team2': [p3['name'], p4['name']]}
            matches.append(match)
            for p in [p1, p2, p3, p4]: games_played[p['name']] += 1
            partnerships[p1['name']][p2['name']] += 1
            partnerships[p2['name']][p1['name']] += 1
            partnerships[p3['name']][p4['name']] += 1
            partnerships[p4['name']][p3['name']] += 1
        else: break
    return matches

def generate_singles_robin(players, k):
    num_players = len(players)
    player_names = [p['name'] for p in players]

    if (num_players * k) % 2 != 0:
        raise ValueError("球员总数和每人对局数的乘积必须为偶数。")

    total_matches = (num_players * k) // 2
    
    games_played = defaultdict(int)
    opponents = defaultdict(lambda: defaultdict(int))
    matches = []
    
    match_pool = list(combinations(player_names, 2))
    
    attempts = 0
    max_attempts = total_matches * 5

    while len(matches) < total_matches and attempts < max_attempts:
        attempts += 1
        # Sort pool by how many times pairs have played
        match_pool.sort(key=lambda p: opponents[p[0]][p[1]])
        
        match_added_in_pass = False
        for p1, p2 in match_pool:
            if games_played[p1] < k and games_played[p2] < k:
                # Check if this match is already in the list to avoid duplicates in the same batch
                # This simple check is not perfect but helps diversity
                is_present = any(m for m in matches if (p1 in m['team1'] and p2 in m['team2']) or (p2 in m['team1'] and p1 in m['team2']))

                # A simple greedy choice might be better
                matches.append({'team1': [p1], 'team2': [p2]})
                games_played[p1] += 1
                games_played[p2] += 1
                opponents[p1][p2] += 1
                opponents[p2][p1] += 1
                match_added_in_pass = True
                break # Move to next attempt to re-sort and pick the best next
        
        if not match_added_in_pass:
            # If a full pass on match_pool yields no result, we might be stuck
            break

    return matches

def generate_mixed_doubles(players, k):
    males = [p for p in players if p['gender'] == 'M']
    females = [p for p in players if p['gender'] == 'F']
    num_males, num_females = len(males), len(females)
    if num_males < 2 or num_females < 2:
        raise ValueError("男女队员人数必须都至少为2人才能进行混双比赛。")
    total_matches = (num_males * k) // 2
    games_played = defaultdict(int)
    partnerships = defaultdict(lambda: defaultdict(int))
    matches = []
    max_attempts = total_matches * 5
    while len(matches) < total_matches and max_attempts > 0:
        max_attempts -= 1
        eligible_males = sorted([p for p in males if games_played[p['name']] < k], key=lambda p: games_played[p['name']])
        eligible_females = sorted([p for p in females if games_played[p['name']] < k], key=lambda p: games_played[p['name']])
        if len(eligible_males) < 2 or len(eligible_females) < 2: break
        m1, m2 = random.sample(eligible_males, 2)
        f1, f2 = random.sample(eligible_females, 2)
        score1 = partnerships[m1['name']][f1['name']] + partnerships[m2['name']][f2['name']]
        score2 = partnerships[m1['name']][f2['name']] + partnerships[m2['name']][f1['name']]
        if score1 <= score2:
            match = {'team1': [m1['name'], f1['name']], 'team2': [m2['name'], f2['name']]}
            partnerships[m1['name']][f1['name']] += 1; partnerships[f1['name']][m1['name']] += 1
            partnerships[m2['name']][f2['name']] += 1; partnerships[f2['name']][m2['name']] += 1
        else:
            match = {'team1': [m1['name'], f2['name']], 'team2': [m2['name'], f1['name']]}
            partnerships[m1['name']][f2['name']] += 1; partnerships[f2['name']][m1['name']] += 1
            partnerships[m2['name']][f1['name']] += 1; partnerships[f1['name']][m2['name']] += 1
        matches.append(match)
        for p in [m1, m2, f1, f2]: games_played[p['name']] += 1
    return matches

# --- API Endpoints ---
@app.route('/api/get_k_options', methods=['POST'])
def get_k_options_route():
    data = request.get_json()
    players = data.get('players', [])
    mode = data.get('mode')
    num_players = len(players)
    num_males = sum(1 for p in players if p['gender'] == 'M')
    num_females = sum(1 for p in players if p['gender'] == 'F')
    options = get_possible_k(num_players, mode, num_males, num_females)
    return jsonify(options)

@app.route('/api/generate', methods=['POST'])
def generate():
    data = request.get_json()
    players = data.get('players', [])
    mode = data.get('mode')
    k = data.get('k')

    if not all([players, mode, k]):
        return jsonify({'error': 'Missing parameters'}), 400
    
    min_players = 2 if mode == 'singles_robin' else 6
    if len(players) < min_players:
        return jsonify({'error': f'队员人数必须至少为{min_players}人。'}), 400

    try:
        if mode == 'mixed':
            matches = generate_mixed_doubles(players, k)
        elif mode == 'singles_robin':
            matches = generate_singles_robin(players, k)
        else:
            matches = generate_random_doubles(players, k)
        # 在生成对局时，为新记录准备一个临时的UUID，但不立即保存
        response_data = {
            'matches': matches, 
            'players': players, 
            'mode': mode, 
            'k': k,
            'id': str(uuid.uuid4()), # 这是一个临时ID，用于前端标识
            'timestamp': None # 时间戳将在保存时设置
        }
        return jsonify(response_data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

# --- 新增：历史记录 API ---
@app.route('/api/history', methods=['GET', 'POST'])
def handle_history():
    if request.method == 'POST':
        data = request.get_json()
        if not data or 'id' not in data:
            return jsonify({'error': '无效的数据格式'}), 400
        
        record_id = data['id']
        # 如果是新记录，设置时间戳
        if not data.get('timestamp'):
            data['timestamp'] = datetime.utcnow().isoformat()

        try:
            db.hset('histories', record_id, json.dumps(data))
            return jsonify({'success': True, 'id': record_id}), 200
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    if request.method == 'GET':
        try:
            all_histories_raw = db.hvals('histories')
            all_histories = [json.loads(h) for h in all_histories_raw]
            all_histories.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            return jsonify(all_histories), 200
        except Exception as e:
            return jsonify({'error': str(e)}), 500

@app.route('/api/history/<record_id>', methods=['DELETE'])
def handle_history_record(record_id):
    try:
        result = db.hdel('histories', record_id)
        if result == 0:
            return jsonify({'error': '记录未找到'}), 404
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Vercel 会处理静态文件，这个根路由可以用于健康检查
@app.route('/')
def home():
    return "Backend is running."


@app.route('/api/history', methods=['POST'])
def save_history():
    data = request.get_json()
    if not data or 'id' not in data:
        return jsonify({'error': '无效的数据格式'}), 400
    
    record_id = data['id']
    # 确保时间戳存在
    if not data.get('timestamp'):
        data['timestamp'] = datetime.utcnow().isoformat()
    
    try:
        # 保存到 Redis (使用哈希表存储所有历史记录)
        db.hset('match_history', record_id, json.dumps(data))
        return jsonify({'success': True, 'record_id': record_id}), 200
    except Exception as e:
        app.logger.error(f"保存历史记录失败: {str(e)}")
        return jsonify({'error': f'保存失败: {str(e)}'}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        # 从 Redis 获取所有历史记录
        all_records = db.hvals('match_history')
        history = [json.loads(record) for record in all_records]
        # 按时间戳排序
        history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return jsonify(history), 200
    except Exception as e:
        app.logger.error(f"获取历史记录失败: {str(e)}")
        return jsonify({'error': f'获取记录失败: {str(e)}'}), 500