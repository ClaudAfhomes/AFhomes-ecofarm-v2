import { useEffect } from 'react';
export function useCmsUnsaved(dirty:boolean) {
  useEffect(()=>{
    if(!dirty)return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const beforeLink=(event:MouseEvent)=>{const link=(event.target as Element)?.closest?.('a[href]');if(link&&!window.confirm('Leave this editor? Your unsaved changes will be lost.')){event.preventDefault();event.stopPropagation();}};
    window.addEventListener('beforeunload',beforeUnload);document.addEventListener('click',beforeLink,true);
    return()=>{window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('click',beforeLink,true);};
  },[dirty]);
}
