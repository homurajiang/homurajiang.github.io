import redis

r = redis.Redis.from_url("redis://default:2aTcH5uXHHgOlsC9FBZOQJdfbMnOnrSj@redis-16255.c292.ap-southeast-1-1.ec2.redns.redis-cloud.com:16255")

success = r.set("foo", "bar")
# True

result = r.get("foo")
print(result)
# >>> bar
