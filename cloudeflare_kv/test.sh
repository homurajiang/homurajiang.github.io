# 写入数据测试
curl -X PUT -H "x-api-key: 42da0738-6e16-4024-8f92-ce920c047b59" -d "hello github pages" https://github-kv-api.homurajiang.workers.dev/test-data

# 读取数据测试
curl -H "x-api-key: 42da0738-6e16-4024-8f92-ce920c047b59" https://github-kv-api.homurajiang.workers.dev/test-data


Test Log

➜ curl -X PUT -H "x-api-key: 42da0738-6e16-4024-8f92-ce920c047b59" -d "hello github pages" https://github-kv-api.homurajiang.workers.dev/test-data
{"success":true,"message":"Data saved"}%

~ via 🅒 base
➜ curl -H "x-api-key: 42da0738-6e16-4024-8f92-ce920c047b59" https://github-kv-api.homurajiang.workers.dev/test-data
hello github pages%