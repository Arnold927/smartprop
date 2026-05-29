import React from 'react';

interface FuturisticLogoProps {
 className?: string;
 size?: 'sm' | 'md' | 'lg' | 'xl';
 showText?: boolean;
}

export default function FuturisticLogo({ className = "", size = "md", showText = true }: FuturisticLogoProps) {
 const sizeClasses = {
 sm: "h-8 w-8",
 md: "h-10 w-10",
 lg: "h-12 w-12",
 xl: "h-16 w-16"
 };

 const textSizeClasses = {
 sm: "text-lg",
 md: "text-xl",
 lg: "text-2xl",
 xl: "text-3xl"
 };

 return (
 <div className={`flex items-center space-x-3 ${className}`}>
 {/* Futuristic Logo Icon */}
 <div className={`${sizeClasses[size]} relative`}>
 <svg
 viewBox="0 0 64 64"
 fill="none"
 xmlns="http://www.w3.org/2000/svg"
 className="w-full h-full"
 >
 {/* Outer Ring with Gradient */}
 <defs>
 <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#3b82f6" />
 <stop offset="50%" stopColor="#1d4ed8" />
 <stop offset="100%" stopColor="#7c3aed" />
 </linearGradient>
 <linearGradient id="innerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#60a5fa" />
 <stop offset="100%" stopColor="#a78bfa" />
 </linearGradient>
 
 {/* Glow Effect */}
 <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
 <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
 <feMerge> 
 <feMergeNode in="coloredBlur"/>
 <feMergeNode in="SourceGraphic"/>
 </feMerge>
 </filter>
 </defs>

 {/* Modern Building Structure */}
 <g fill="url(#logoGradient)" opacity="0.9">
 {/* Main Building */}
 <rect x="20" y="20" width="24" height="32" rx="2" />
 {/* Building Roof */}
 <path d="M18 20 L32 8 L46 20 Z" />
 </g>

 {/* Building Details */}
 <g fill="white" opacity="0.3">
 {/* Windows Grid */}
 <rect x="23" y="24" width="3" height="3" rx="0.5" />
 <rect x="29" y="24" width="3" height="3" rx="0.5" />
 <rect x="35" y="24" width="3" height="3" rx="0.5" />
 <rect x="23" y="30" width="3" height="3" rx="0.5" />
 <rect x="29" y="30" width="3" height="3" rx="0.5" />
 <rect x="35" y="30" width="3" height="3" rx="0.5" />
 <rect x="23" y="36" width="3" height="3" rx="0.5" />
 <rect x="29" y="36" width="3" height="3" rx="0.5" />
 <rect x="35" y="36" width="3" height="3" rx="0.5" />
 
 {/* Main Entrance */}
 <rect x="28" y="44" width="8" height="8" rx="1" />
 </g>

 {/* Smart Elements */}
 <g stroke="url(#logoGradient)" strokeWidth="1.5" fill="none" opacity="0.7">
 {/* Property Connection Lines */}
 <path d="M8 32 L20 32" strokeDasharray="2,2">
 <animate attributeName="stroke-dashoffset" values="0;-8" dur="2s" repeatCount="indefinite" />
 </path>
 <path d="M44 32 L56 32" strokeDasharray="2,2">
 <animate attributeName="stroke-dashoffset" values="0;-8" dur="2s" repeatCount="indefinite" />
 </path>
 </g>

 {/* Property Indicators */}
 <g fill="url(#logoGradient)" opacity="0.8">
 {/* Left Property */}
 <rect x="4" y="28" width="8" height="8" rx="1">
 <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
 </rect>
 {/* Right Property */}
 <rect x="52" y="28" width="8" height="8" rx="1">
 <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" begin="1s" repeatCount="indefinite" />
 </rect>
 </g>

 {/* Management Hub Indicator */}
 <circle cx="32" cy="14" r="3" fill="url(#logoGradient)" opacity="0.9">
 <animate attributeName="r" values="3;4;3" dur="2s" repeatCount="indefinite" />
 <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite" />
 </circle>

 {/* Property Management Connections */}
 <g stroke="url(#logoGradient)" strokeWidth="1" opacity="0.5">
 <line x1="8" y1="32" x2="28" y2="18" strokeDasharray="1,2">
 <animate attributeName="stroke-dashoffset" values="0;-6" dur="1.5s" repeatCount="indefinite" />
 </line>
 <line x1="56" y1="32" x2="36" y2="18" strokeDasharray="1,2">
 <animate attributeName="stroke-dashoffset" values="0;-6" dur="1.5s" begin="0.5s" repeatCount="indefinite" />
 </line>
 </g>
 </svg>
 </div>

 {/* Company Text */}
 {showText && (
 <div className="flex flex-col">
 <span className={`font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 bg-clip-text text-transparent ${textSizeClasses[size]}`}>
 Smart Prop
 </span>
 <span className="text-xs text-muted-foreground font-medium tracking-wider">
 PROPERTY MANAGEMENT
 </span>
 </div>
 )}
 </div>
 );
}