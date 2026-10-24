import assert from 'node:assert/strict';
import test from 'node:test';
import { statsCalendarMonths } from '../../app/dashboard/stats/stats.months.ts';
import { readMeasuredEvolutionCache, writeMeasuredEvolutionCache, MEASURED_EVOLUTION_CACHE_TTL } from '../../app/dashboard/stats/stats.evolution-cache.ts';
const now=Date.parse('2026-10-24T12:00:00Z');
const periods=statsCalendarMonths(new Date(now));
const months=periods.map(period=>({period,loaded:true,values:{facebook:{visibility:0,clicks:12},instagram:{visibility:231,clicks:null}}}));
const channels='facebook,instagram';

test('a warm monthly snapshot restores exact measured values including zeroes',()=>{
  const raw=writeMeasuredEvolutionCache('account-a',channels,months,now);
  assert.deepEqual(readMeasuredEvolutionCache(raw,'account-a',channels,periods,now+1000),months);
});
test('history cache cannot cross accounts, channel catalogues, days, or its freshness window',()=>{
  const raw=writeMeasuredEvolutionCache('account-a',channels,months,now);
  assert.equal(readMeasuredEvolutionCache(raw,'account-b',channels,periods,now),null);
  assert.equal(readMeasuredEvolutionCache(raw,'account-a','facebook',periods,now),null);
  assert.equal(readMeasuredEvolutionCache(raw,'account-a',channels,statsCalendarMonths(new Date('2026-10-25T12:00:00Z')),now),null);
  assert.equal(readMeasuredEvolutionCache(raw,'account-a',channels,periods,now+MEASURED_EVOLUTION_CACHE_TTL),null);
  assert.equal(readMeasuredEvolutionCache(raw,'account-a',channels,periods,now-1),null);
});
test('malformed browser data never becomes chart observations',()=>{
  assert.equal(readMeasuredEvolutionCache('{','account-a',channels,periods,now),null);
  const raw=JSON.parse(writeMeasuredEvolutionCache('account-a',channels,months,now)!);
  raw.months[1].values.facebook.visibility=-1;
  assert.equal(readMeasuredEvolutionCache(JSON.stringify(raw),'account-a',channels,periods,now),null);
  raw.months[1].values.facebook.visibility=undefined;
  assert.equal(readMeasuredEvolutionCache(JSON.stringify(raw),'account-a',channels,periods,now),null);
});
test('failed or empty first loads cannot replace a warm measured snapshot',()=>{
  assert.equal(writeMeasuredEvolutionCache('account-a',channels,months.map((m,i)=>({...m,loaded:i!==1})),now),null);
  assert.equal(writeMeasuredEvolutionCache('account-a',channels,months.map(m=>({...m,values:{facebook:{visibility:null,clicks:null}}})),now),null);
});
