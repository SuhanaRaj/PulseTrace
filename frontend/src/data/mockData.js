export const services = [
  { id:'gateway', name:'API Gateway', health:'healthy', rate:1240, error:0.18, latency:84, p95:152, cpu:46, memory:62, deploy:'2h ago', instances:8, color:'#38bdf8' },
  { id:'auth', name:'Auth Service', health:'healthy', rate:820, error:0.06, latency:42, p95:96, cpu:32, memory:48, deploy:'1d ago', instances:4, color:'#34d399' },
  { id:'mission', name:'Mission Service', health:'degraded', rate:610, error:1.42, latency:198, p95:476, cpu:78, memory:71, deploy:'3h ago', instances:5, color:'#fbbf24' },
  { id:'notify', name:'Notification Service', health:'healthy', rate:240, error:0.12, latency:61, p95:118, cpu:26, memory:39, deploy:'4d ago', instances:3, color:'#a78bfa' },
  { id:'postgres', name:'PostgreSQL', health:'degraded', rate:1440, error:0.7, latency:32, p95:88, cpu:69, memory:83, deploy:'8d ago', instances:2, color:'#60a5fa' },
  { id:'redis', name:'Redis Cache', health:'healthy', rate:3120, error:0.02, latency:4, p95:12, cpu:41, memory:58, deploy:'8d ago', instances:3, color:'#2dd4bf' }
]
export const traces = [
  {id:'tr_8f2a91c4', service:'API Gateway', route:'/v1/missions/launch', method:'POST', status:'error', duration:742, spans:9, time:'2 min ago'},
  {id:'tr_7e1b30da', service:'API Gateway', route:'/v1/users/me', method:'GET', status:'success', duration:126, spans:6, time:'4 min ago'},
  {id:'tr_5d92f1ab', service:'Mission Service', route:'/v1/missions/preview', method:'POST', status:'success', duration:319, spans:8, time:'7 min ago'},
  {id:'tr_3c4e8f10', service:'API Gateway', route:'/v1/auth/login', method:'POST', status:'success', duration:181, spans:7, time:'9 min ago'},
  {id:'tr_2a90dc71', service:'Notification Service', route:'/v1/notifications', method:'GET', status:'success', duration:74, spans:4, time:'12 min ago'},
  {id:'tr_0b19a6e2', service:'Mission Service', route:'/v1/missions/42', method:'GET', status:'error', duration:1012, spans:11, time:'15 min ago'},
  {id:'tr_9a12be77', service:'Auth Service', route:'/v1/tokens/refresh', method:'POST', status:'success', duration:93, spans:5, time:'18 min ago'}
]
export const errors = [
  {id:'err-412', title:'Database connection timeout', service:'Mission Service', count:87, first:'Today, 09:14', last:'2 min ago', status:'Open', stack:'TimeoutError: Connection acquisition timed out after 5000ms\n  at Pool.acquire (db/pool.js:104)\n  at MissionRepository.findById (repositories/mission.js:42)'},
  {id:'err-327', title:'Unauthorized request', service:'API Gateway', count:42, first:'Today, 08:30', last:'5 min ago', status:'Resolved', stack:'AuthorizationError: Token signature is invalid\n  at verifyToken (middleware/auth.js:31)'},
  {id:'err-291', title:'Redis connection failure', service:'Auth Service', count:19, first:'Yesterday', last:'21 min ago', status:'Open', stack:'Error: ECONNREFUSED 10.20.3.17:6379\n  at RedisConnector.connect (cache/redis.js:18)'},
  {id:'err-188', title:'Mission service unavailable', service:'API Gateway', count:14, first:'Yesterday', last:'1h ago', status:'Investigating', stack:'ServiceUnavailable: upstream returned 503\n  at proxyRequest (gateway/proxy.js:83)'}
]
export const chartData = Array.from({length:18}, (_,i)=>({time:`${String(9+Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`, requests:850+Math.round(Math.sin(i*.7)*170)+i*24, errors:Math.max(2,Math.round(7+Math.sin(i*.9)*5+(i===12?14:0))), latency:88+Math.round(Math.cos(i*.65)*16)+(i===12?42:0)}))
export const activities = [
  {text:'Deployment completed for Mission Service', detail:'v2.18.4 • production', kind:'deploy'},
  {text:'Elevated latency detected', detail:'PostgreSQL p95 crossed 80ms', kind:'warn'},
  {text:'New error group detected', detail:'Database connection timeout', kind:'error'},
  {text:'Trace completed successfully', detail:'POST /v1/auth/login • 181ms', kind:'ok'}
]
export const spanData = [
  {id:'s1', name:'POST /v1/missions/launch', service:'API Gateway', start:0, duration:742, depth:0, status:'error', attrs:{'http.method':'POST','http.route':'/v1/missions/launch','http.status_code':'504'}},
  {id:'s2', name:'Authenticate request', service:'Auth Service', start:12, duration:83, depth:1, status:'success', attrs:{'user.id':'usr_2084','auth.method':'bearer'}},
  {id:'s3', name:'GET session', service:'Redis Cache', start:28, duration:8, depth:2, status:'success', attrs:{'db.system':'redis','db.operation':'GET'}},
  {id:'s4', name:'Launch mission', service:'Mission Service', start:112, duration:612, depth:1, status:'error', attrs:{'mission.id':'mis_42','region':'us-east-1'}},
  {id:'s5', name:'SELECT mission', service:'PostgreSQL', start:142, duration:482, depth:2, status:'error', attrs:{'db.system':'postgresql','db.statement':'SELECT * FROM missions WHERE id = $1'}},
  {id:'s6', name:'Publish notification', service:'Notification Service', start:645, duration:53, depth:2, status:'success', attrs:{'topic':'mission.launched','provider':'internal'}}
]
export const graphEdges = [ ['gateway','auth'],['gateway','mission'],['gateway','notify'],['auth','redis'],['mission','postgres'],['mission','notify'],['mission','redis'] ]
