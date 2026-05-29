import React, { useState } from 'react';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import MobileHeader from './mobile-header';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <MobileHeader onMenuClick={() => setIsMobileSidebarOpen(true)} />

      <div className="flex">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed(c => !c)}
          />
        </div>

        {/* Mobile sidebar */}
        {isMobileSidebarOpen && (
          <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
        )}

        {/* Main content area — offset by sidebar width */}
        <div
          className={`flex-1 min-w-0 transition-all duration-200 ease-in-out ${
            isCollapsed ? 'md:ml-16' : 'md:ml-64'
          }`}
        >
          {/* Toggle button pinned to the sidebar edge, sitting on top of the top bar */}
          <button
            onClick={() => setIsCollapsed(c => !c)}
            className={`
              hidden md:flex items-center justify-center
              fixed top-3.5 z-[60]
              w-7 h-7 rounded-md
              bg-card border border-border shadow-sm
              text-muted-foreground hover:text-foreground hover:bg-muted
              transition-all duration-200
            `}
            style={{ left: isCollapsed ? '52px' : '244px' }}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed
              ? <PanelLeftOpen className="w-3.5 h-3.5" />
              : <PanelLeftClose className="w-3.5 h-3.5" />
            }
          </button>

          <TopBar />
          <main className="p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}