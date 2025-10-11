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
# 显式配置 CORS，以更好地处理跨域预检请求
CORS(app, resources={r"/api/*": {"origins": "*"}})

# --- Redis 连接 ---
db = None
try:
    # 从环境变量获取 Redis URL
    redis_url = os.environ.get('homurajiang_badminton_REDIS_URL')
    if redis_url:
        db = redis.from_url(redis_url, decode_responses=True)
        db.ping() # 测试连接
        app.logger.info("成功连接到 Redis。")
    else:
        app.logger.warning("未设置 REDIS_URL 环境变量，数据库功能将被禁用。")
except Exception as e:
    # 如果连接失败，记录错误，db 将保持为 None
    app.logger.error(f"连接到 Redis 失败: {e}")
    db = None

# --- 核心算法 (保持不变) ---
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
    
    all_possible_matches = list(combinations(players, 4))
    
    while len(matches) < total_matches:
        available_players = [p for p in players if games_played[p['name']] < k]
        if len(available_players) < 4:
            break

        best_match_found = None
        lowest_partnership_score = float('inf')

        # 尝试从所有可能的对局中找到一个最优的
        random.shuffle(all_possible_matches)
        
        for p1, p2, p3, p4 in all_possible_matches:
            # 确保所有玩家都在可用列表中
            if all(p in available_players for p in [p1, p2, p3, p4]):
                # 评估三种组合方式
                # 1. (p1, p2) vs (p3, p4)
                score1 = partnerships[p1['name']][p2['name']] + partnerships[p3['name']][p4['name']]
                # 2. (p1, p3) vs (p2, p4)
                score2 = partnerships[p1['name']][p3['name']] + partnerships[p2['name']][p4['name']]
                # 3. (p1, p4) vs (p2, p3)
                score3 = partnerships[p1['name']][p4['name']] + partnerships[p2['name']][p3['name']]

                min_score = min(score1, score2, score3)

                if min_score < lowest_partnership_score:
                    lowest_partnership_score = min_score
                    if min_score == score1:
                        best_match_found = ([p1, p2], [p3, p4])
                    elif min_score == score2:
                        best_match_found = ([p1, p3], [p2, p4])
                    else:
                        best_match_found = ([p1, p4], [p2, p3])
                
                # 如果找到了一个从未有过的组合，就立即使用
                if lowest_partnership_score == 0:
                    break
        
        if best_match_found:
            team1_players, team2_players = best_match_found
            team1_names = [p['name'] for p in team1_players]
            team2_names = [p['name'] for p in team2_players]
            
            matches.append({'team1': team1_names, 'team2': team2_names})
            
            # 更新统计数据
            for p in team1_players + team2_players:
                games_played[p['name']] += 1
            
            partnerships[team1_names[0]][team1_names[1]] += 1
            partnerships[team1_names[1]][team1_names[0]] += 1
            partnerships[team2_names[0]][team2_names[1]] += 1
            partnerships[team2_names[1]][team2_names[0]] += 1
        else:
            # 如果没有找到合适的对局，则退出循环
            break
            
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
        match_pool.sort(key=lambda p: opponents[p[0]][p[1]])
        match_added_in_pass = False
        for p1, p2 in match_pool:
            if games_played[p1] < k and games_played[p2] < k:
                matches.append({'team1': [p1], 'team2': [p2]})
                games_played[p1] += 1
                games_played[p2] += 1
                opponents[p1][p2] += 1
                opponents[p2][p1] += 1
                match_added_in_pass = True
                break
        if not match_added_in_pass:
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
    name = data.get('name', '')

    if not all([players, mode, k]):
        return jsonify({'error': 'Missing parameters'}), 400
    
    min_players = 2 if mode == 'singles_robin' else 4
    if len(players) < min_players:
        return jsonify({'error': f'队员人数必须至少为{min_players}人。'}), 400

    try:
        if mode == 'mixed':
            matches = generate_mixed_doubles(players, k)
        elif mode == 'singles_robin':
            matches = generate_singles_robin(players, k)
        else:
            matches = generate_random_doubles(players, k)
        
        response_data = {
            'matches': matches, 
            'players': players, 
            'mode': mode, 
            'k': k,
            'id': str(uuid.uuid4()),
            'timestamp': None,
            'name': name
        }
        return jsonify(response_data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

# --- 历史记录 API (使用新的 ID 列表逻辑) ---
@app.route('/api/history', methods=['GET', 'POST'])
def handle_history():
    if db is None:
        return jsonify({'error': '数据库服务不可用。'}), 503

    if request.method == 'POST':
        data = request.get_json()
        if not data or 'id' not in data:
            return jsonify({'error': '无效的数据格式'}), 400
        
        record_id = data['id']
        if not data.get('timestamp'):
            data['timestamp'] = datetime.utcnow().isoformat()

        try:
            # 使用 pipeline 保证原子性
            pipe = db.pipeline()
            # 1. 存入哈希表
            pipe.hset('histories', record_id, json.dumps(data))
            # 2. 将 ID 添加到新的 Set 中
            pipe.sadd('match_history_ids', record_id)
            pipe.execute()
            
            return jsonify({'success': True, 'id': record_id}), 200
        except Exception as e:
            app.logger.error(f"保存历史记录失败 (ID: {record_id}): {e}")
            return jsonify({'error': '无法向数据库写入数据。'}), 500

    if request.method == 'GET':
        try:
            # 1. 从 Set 中获取所有 ID
            history_ids = db.smembers('match_history_ids')
            if not history_ids:
                return jsonify([]), 200
            
            # 2. 一次性获取所有记录
            all_histories_raw = db.hmget('histories', list(history_ids))
            
            # 3. 清理和排序
            all_histories = [json.loads(h) for h in all_histories_raw if h]
            all_histories.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            
            return jsonify(all_histories), 200
        except Exception as e:
            app.logger.error(f"获取全部历史记录失败: {e}")
            return jsonify({'error': '无法从数据库读取数据。'}), 500

@app.route('/api/history/<record_id>', methods=['GET', 'DELETE'])
def handle_history_record(record_id):
    if db is None:
        return jsonify({'error': '数据库服务不可用。'}), 503

    if request.method == 'GET':
        try:
            record_raw = db.hget('histories', record_id)
            if not record_raw:
                return jsonify({'error': '记录未找到'}), 404
            return jsonify(json.loads(record_raw)), 200
        except Exception as e:
            app.logger.error(f"获取单条历史记录失败 (ID: {record_id}): {e}")
            return jsonify({'error': '无法从数据库读取数据。'}), 500

    if request.method == 'DELETE':
        try:
            # 使用 pipeline 保证原子性
            pipe = db.pipeline()
            # 1. 从哈希表中删除
            pipe.hdel('histories', record_id)
            # 2. 从 Set 中删除 ID
            pipe.srem('match_history_ids', record_id)
            results = pipe.execute()
            
            # 检查 hdel 的结果
            if results[0] == 0:
                return jsonify({'error': '记录未找到'}), 404
                
            return jsonify({'success': True}), 200
        except Exception as e:
            app.logger.error(f"删除历史记录失败 (ID: {record_id}): {e}")
            return jsonify({'error': '无法从数据库删除数据。'}), 500

# Vercel 会处理静态文件，这个根路由可以用于健康检查
@app.route('/')
def home():
    return "Backend is running."