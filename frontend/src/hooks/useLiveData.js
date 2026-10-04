import { useEffect, useState } from 'react'
export function useLiveData(paused) { const [tick,setTick]=useState(0); useEffect(()=>{ if(paused) return; const id=setInterval(()=>setTick(t=>t+1),5000); return()=>clearInterval(id) },[paused]); return tick }
