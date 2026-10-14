import { create } from 'zustand';
interface WorkspaceState { amountsHidden:boolean; togglePrivacy:()=>void; collapsed:boolean; toggleSidebar:()=>void }
export const useWorkspaceStore=create<WorkspaceState>()((set)=>({amountsHidden:false,togglePrivacy:()=>set(s=>({amountsHidden:!s.amountsHidden})),collapsed:false,toggleSidebar:()=>set(s=>({collapsed:!s.collapsed}))}));
