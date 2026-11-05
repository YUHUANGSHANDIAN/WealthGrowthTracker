import { Suspense, lazy, useEffect, useState } from 'react';
import { NavIcon } from './components/ui/NavIcon';
import { useWorkspaceStore } from './store/workspaceStore';
import { applyAppearance } from './utils/appearance';
import { CommandPalette } from './features/workspace/CommandPalette';
import { OverviewPanel } from './features/dashboard/OverviewPanel';
import { useAppStore } from './store/appStore';
import { useNavigationStore, initNavigation, sectionForTab } from './store/navigationStore';
import { storageService } from './services/storage';
import { RecoveryPanel } from './features/data/RecoveryPanel';
import { totalAssets } from './utils/channels';
import { getLevelByAmount } from './constants/levels';
import { applyLevelTheme, applyNeutralTheme } from './utils/theme';
import { APP_VERSION } from './constants/version';
import { todayString } from './utils/date';
import { ToastHost } from './components/ui/ToastHost';
import { Spinner } from './components/ui/primitives';
import { AssetsPanel } from './features/assets/AssetsPanel';
import { CoinRainOverlay } from './features/coinRain/CoinRainOverlay';
import { LevelUpCelebrationOverlay } from './features/celebrate/LevelUpCelebrationOverlay';
import { LevelExplorer } from './features/levels/LevelExplorer';
import { SettingsPage } from './features/settings/SettingsPage';
import { LockScreen } from './features/settings/LockScreen';
import { AIConnectionCenter as AISettingsPanel } from './features/ai/AIConnectionCenter';
import { AIWorkspace } from './features/ai/AIWorkspace';
import { MobileNavigation } from './features/workspace/MobileNavigation';
import { MaintenanceOverlay } from './features/workspace/MaintenanceOverlay';
import { MAIN_NAV_ITEMS, SECONDARY_NAV_ITEMS } from './constants/navigation';
import { APP_BRAND } from './constants/brand';
const HistoryPanel=lazy(()=>import('./features/history/HistoryPanel').then(m=>({default:m.HistoryPanel})));
const ReportsPanel=lazy(()=>import('./features/reports/ReportsPanel').then(m=>({default:m.ReportsPanel})));
const AssetTrendsPanel=lazy(()=>import('./features/analysis/AssetTrendsPanel').then(m=>({default:m.AssetTrendsPanel})));
const FinanceWorkbench=lazy(()=>import('./features/finance/FinanceWorkbench').then(m=>({default:m.FinanceWorkbench})));
const PredictionPanel=lazy(()=>import('./features/prediction/PredictionPanel').then(m=>({default:m.PredictionPanel})));
const GoalsPanel=lazy(()=>import('./features/goals/GoalsPanel').then(m=>({default:m.GoalsPanel})));
const LotteryPanel=lazy(()=>import('./features/lottery/LotteryPanel').then(m=>({default:m.LotteryPanel})));
const DataPanel=lazy(()=>import('./features/data/DataPanel').then(m=>({default:m.DataPanel})));
function PanelFallback(){return <div className="flex items-center justify-center py-20 text-slate-400"><Spinner className="h-5 w-5 mr-2"/>加载中…</div>;}
export default function App(){
 const hydrated=useAppStore(s=>s.hydrated);const hydrate=useAppStore(s=>s.hydrate);const channels=useAppStore(s=>s.channels);const locked=useAppStore(s=>s.locked);const follow=useAppStore(s=>s.appearance.followWealthTheme);const appearance=useAppStore(s=>s.appearance);
 const tab=useNavigationStore(s=>s.tab);const financeTaskKind=useNavigationStore(s=>s.financeTaskKind);const settingsSection=useNavigationStore(s=>s.settingsSection);const navigate=useNavigationStore(s=>s.navigate);const collapsed=useWorkspaceStore(s=>s.collapsed);const amountsHidden=useWorkspaceStore(s=>s.amountsHidden);const togglePrivacy=useWorkspaceStore(s=>s.togglePrivacy);const toggleSidebar=useWorkspaceStore(s=>s.toggleSidebar);
 const mainSection=sectionForTab(tab);const mainNav=MAIN_NAV_ITEMS.find(item=>item.id===mainSection)??MAIN_NAV_ITEMS[0]!;const secondaryItems=SECONDARY_NAV_ITEMS[mainSection];
 const [levelOpen,setLevelOpen]=useState(false);const [searchOpen,setSearchOpen]=useState(false);const total=totalAssets(channels);const level=getLevelByAmount(total);
 const recoveryError=useAppStore(s=>s.recoveryError);const saveStatus=useAppStore(s=>s.saveStatus);const saveError=useAppStore(s=>s.saveError);
 const maintenanceLabel=useAppStore(s=>s.maintenanceLabel);
 async function retrySave(){try{await storageService.flush();}catch{/* Store exposes the failure in the status region. */}}
 useEffect(()=>{void hydrate().catch(()=>{});return initNavigation();},[hydrate]);
 useEffect(()=>{if(follow)applyLevelTheme(level);else applyNeutralTheme();},[level,follow]);
 useEffect(()=>applyAppearance(appearance),[appearance]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
 useEffect(()=>{const onUnload=(event:BeforeUnloadEvent)=>{if(useAppStore.getState().saveStatus!=='saved'){event.preventDefault();event.returnValue='';}void storageService.flush().catch(()=>{});};window.addEventListener('beforeunload',onUnload);return()=>window.removeEventListener('beforeunload',onUnload);},[]);
 if(recoveryError)return <RecoveryPanel error={recoveryError}/>;
 if(!hydrated)return <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-500"><div className="text-5xl animate-float" aria-hidden>{level.badge}</div><Spinner className="h-6 w-6 text-emerald-500"/><p className="text-sm">正在加载财富成长记…</p></div>;
 if(locked)return <LockScreen/>;
 return <div className={'workspace '+(collapsed?'collapsed ':'')+(amountsHidden?'privacy-hidden':'')}>
  <a className="skip-link" href="#main-content">跳到主要内容</a>
  <aside className="workspace-sidebar" aria-label="主导航"><div className="workspace-brand"><span className="text-2xl">{level.badge}</span><div>WealthGrowthTracker<small>财富成长记 · 本地财富工作台</small></div></div><nav className="workspace-nav">{MAIN_NAV_ITEMS.map(item=><button key={item.id} onClick={()=>navigate({tab:item.defaultTab,financeTaskKind:item.id==='finance'?'monthly-review':undefined})} aria-current={mainSection===item.id?'page':undefined} title={item.label}><NavIcon id={item.defaultTab}/><span className="nav-label">{item.label}</span></button>)}</nav><div className="workspace-sidebar-footer">v{APP_VERSION} · {APP_BRAND}</div></aside>
  <div className="workspace-body"><header className="workspace-header"><div><h1>{mainNav.label}</h1><p>本地优先 · 业务日期 {todayString()}</p></div><div className="workspace-actions"><span role="status" aria-live="polite" title={saveError??undefined}>{saveStatus==='saved'?'已保存':saveStatus==='saving'?'正在保存…':saveStatus==='pending'?'等待保存':'保存失败'}</span>{saveStatus==='error'&&<button onClick={()=>void retrySave()} title={saveError??undefined}>重试保存</button>}<button onClick={()=>setSearchOpen(true)} aria-label="搜索 (Ctrl+K)">⌕ <span className="desktop-action">搜索</span></button><button onClick={togglePrivacy} aria-label={amountsHidden?'显示金额':'隐藏金额'}>{amountsHidden?'◉':'◌'}</button><button className="desktop-action" onClick={()=>toggleSidebar()} aria-label="折叠或展开导航">{collapsed?'»':'«'}</button><button onClick={()=>navigate({tab:'settings',settingsSection:undefined})} aria-label="打开设置页面">⚙</button></div></header>
   {secondaryItems.length>1&&<nav className="workspace-subnav" aria-label={`${mainNav.label}子导航`}>{secondaryItems.map(item=>{const active=item.financeTaskKind?tab==='monthly'&&(financeTaskKind??'monthly-review')===item.financeTaskKind:item.tab===tab&&(!item.settingsSection||settingsSection===item.settingsSection);return <button key={`${item.tab}:${item.financeTaskKind??item.settingsSection??item.label}`} type="button" aria-current={active?'page':undefined} onClick={()=>navigate({tab:item.tab,financeTaskKind:item.financeTaskKind,settingsSection:item.settingsSection})}>{item.label}</button>})}</nav>}
   <main id="main-content" className="workspace-content"><Suspense fallback={<PanelFallback/>}>{tab==='overview'&&<OverviewPanel onOpenLevels={()=>setLevelOpen(true)}/>} {tab==='assets'&&<AssetsPanel/>}{tab==='history'&&<HistoryPanel/>}{tab==='reports'&&<ReportsPanel/>}{tab==='analysis'&&<AssetTrendsPanel/>}{tab==='monthly'&&<FinanceWorkbench/>}{tab==='prediction'&&<PredictionPanel/>}{tab==='goals'&&<GoalsPanel/>}{tab==='lottery'&&<LotteryPanel/>}{tab==='data'&&<DataPanel/>}{tab==='ai'&&<AISettingsPanel/>}{tab==='settings'&&<SettingsPage/>}</Suspense></main>
  </div><AIWorkspace/><ToastHost/><CoinRainOverlay/><LevelUpCelebrationOverlay/><LevelExplorer open={levelOpen} onClose={()=>setLevelOpen(false)}/><CommandPalette open={searchOpen} onClose={()=>setSearchOpen(false)}/><MobileNavigation/>{maintenanceLabel&&<MaintenanceOverlay label={maintenanceLabel}/>}
 </div>;
}
