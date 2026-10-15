import { create } from 'zustand';
import { isSettingsSection, type SettingsSectionId } from '../constants/settings';
export const TAB_IDS = ['overview','assets','history','reports','analysis','monthly','prediction','goals','lottery','data','ai','settings'] as const;
export type TabId = typeof TAB_IDS[number];
export interface Route { tab: TabId; reportId?: string; channelId?: string; lotteryProjectId?: string; goalId?: string; startDate?: string; endDate?: string; historyDate?: string; healthFilter?: string; settingsSection?: SettingsSectionId }
const EMPTY: Route = {tab:'overview',reportId:undefined,channelId:undefined,lotteryProjectId:undefined,goalId:undefined,startDate:undefined,endDate:undefined,historyDate:undefined,healthFilter:undefined,settingsSection:undefined};
const isTab = (v:unknown):v is TabId => TAB_IDS.includes(v as TabId);
function date(v:string|null):string|undefined { if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return; const d=new Date(v+'T12:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v?v:undefined; }
export function parseHash(hash=typeof window==='undefined'?'':window.location.hash):Route {
 const [path='',query='']=hash.replace(/^#\/?/,'').split('?'); const seg=path.split('/').filter(Boolean); if(!isTab(seg[0])) return {...EMPTY}; const r={...EMPTY,tab:seg[0]}; let id:string|undefined;
 try {id=seg[2]?decodeURIComponent(seg[2]):undefined;} catch {return {...EMPTY};}
 if(seg[1]==='report' && r.tab==='reports') r.reportId=id;
 if(seg[1]==='channel' && ['assets','analysis'].includes(r.tab)) r.channelId=id;
 if(seg[1]==='project' && r.tab==='lottery') r.lotteryProjectId=id;
 if(seg[1]==='goal' && ['goals','prediction'].includes(r.tab)) r.goalId=id;
 const q=new URLSearchParams(query); r.startDate=date(q.get('startDate')); r.endDate=date(q.get('endDate')); if(r.startDate && r.endDate && r.startDate>r.endDate){r.startDate=undefined;r.endDate=undefined;} r.historyDate=date(q.get('historyDate')); if(r.tab==='data')r.healthFilter=q.get('healthFilter')??undefined; const section=q.get('section'); if(r.tab==='settings'&&isSettingsSection(section))r.settingsSection=section; return r;
}
export function buildHash(r:Route):string { const parts:string[]=[r.tab]; const target=r.reportId?['report',r.reportId]:r.channelId?['channel',r.channelId]:r.lotteryProjectId?['project',r.lotteryProjectId]:r.goalId?['goal',r.goalId]:[]; parts.push(...target.map(encodeURIComponent));const q=new URLSearchParams();for(const k of ['startDate','endDate','historyDate','healthFilter'] as const) if(r[k])q.set(k,r[k]!);if(r.tab==='settings'&&isSettingsSection(r.settingsSection))q.set('section',r.settingsSection);return '#/'+parts.join('/')+(q.size?'?'+q:''); }
interface NavigationState extends Route { navigate:(route:Partial<Route>)=>void;reset:()=>void }
export const useNavigationStore=create<NavigationState>()((set,get)=>({...parseHash(),navigate(route){const next=parseHash(buildHash({...EMPTY,tab:get().tab,...route}));set(next);if(typeof window!=='undefined' && window.location.hash!==buildHash(next))window.location.hash=buildHash(next);},reset(){get().navigate({tab:'overview'});}}));
export function initNavigation():()=>void {if(typeof window==='undefined')return ()=>{};const apply=()=>useNavigationStore.setState(parseHash());apply();window.addEventListener('hashchange',apply);return ()=>window.removeEventListener('hashchange',apply);}
