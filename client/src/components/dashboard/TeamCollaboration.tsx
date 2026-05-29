import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserPlus, Clock, Pause, Square } from 'lucide-react';

export function TeamCollaboration() {
 const teamMembers = [
 {
 name: 'Alexandra Duff',
 role: 'Working on GitHub Project Repository',
 status: 'Completed',
 avatar: '/api/placeholder/32/32',
 initials: 'AD',
 statusColor: 'green'
 },
 {
 name: 'Edwin Adenika',
 role: 'Working on Integrator User Authorization System',
 status: 'In Progress',
 avatar: '/api/placeholder/32/32',
 initials: 'EA',
 statusColor: 'yellow'
 },
 {
 name: 'Isaac Oluwaremiloun',
 role: 'Working on Develop Smart Filter Functionality',
 status: 'Pending',
 avatar: '/api/placeholder/32/32',
 initials: 'IO',
 statusColor: 'gray'
 },
 {
 name: 'David Oshodi',
 role: 'Working on Responsive Layout for Homepage',
 status: 'In Progress',
 avatar: '/api/placeholder/32/32',
 initials: 'DO',
 statusColor: 'yellow'
 }
 ];

 const projectProgress = {
 completed: 41,
 inProgress: 32,
 pending: 27
 };

 return (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Team Collaboration */}
 <Card>
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <CardTitle className="text-lg font-semibold">Team Collaboration</CardTitle>
 <Button size="sm" variant="outline">
 <UserPlus className="h-3 w-3 mr-1" />
 Add Member
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {teamMembers.map((member, index) => (
 <div key={index} className="flex items-center space-x-3">
 <Avatar className="h-8 w-8">
 <AvatarFallback className="text-xs font-medium">
 {member.initials}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground truncate">
 {member.name}
 </p>
 <p className="text-xs text-muted-foreground truncate">
 {member.role}
 </p>
 </div>
 <Badge 
 variant="outline" 
 className={`text-xs px-2 py-1 border-0 ${
 member.statusColor === 'green' 
 ? 'bg-green-50 text-green-700'
 : member.statusColor === 'yellow'
 ? 'bg-yellow-50 text-yellow-700'
 : 'bg-muted text-foreground'
 }`}
 >
 {member.status}
 </Badge>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Project Progress & Time Tracker */}
 <div className="space-y-6">
 {/* Project Progress */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-lg font-semibold">Project Progress</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {/* Circular Progress */}
 <div className="flex items-center justify-center">
 <div className="relative">
 <svg className="h-24 w-24 transform -rotate-90" viewBox="0 0 100 100">
 <circle
 cx="50"
 cy="50"
 r="40"
 stroke="currentColor"
 strokeWidth="6"
 fill="transparent"
 className="text-gray-200"
 />
 <circle
 cx="50"
 cy="50"
 r="40"
 stroke="currentColor"
 strokeWidth="6"
 fill="transparent"
 strokeDasharray={`${projectProgress.completed * 2.51} 251`}
 className="text-emerald-500"
 />
 </svg>
 <div className="absolute inset-0 flex items-center justify-center">
 <span className="text-xl font-bold text-foreground">
 {projectProgress.completed}%
 </span>
 </div>
 </div>
 </div>
 
 <div className="text-center text-sm text-muted-foreground">
 Project Ended
 </div>
 
 {/* Progress Legend */}
 <div className="flex justify-center space-x-4 text-xs">
 <div className="flex items-center space-x-1">
 <div className="w-2 h-2 rounded-full bg-emerald-500" />
 <span className="text-muted-foreground">Completed</span>
 </div>
 <div className="flex items-center space-x-1">
 <div className="w-2 h-2 rounded-full bg-blue-500" />
 <span className="text-muted-foreground">In Progress</span>
 </div>
 <div className="flex items-center space-x-1">
 <div className="w-2 h-2 rounded-full bg-gray-300" />
 <span className="text-muted-foreground">Pending</span>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Time Tracker */}
 <Card className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white">
 <CardContent className="p-6">
 <div className="space-y-4">
 <h3 className="text-lg font-semibold">Time Tracker</h3>
 <div className="text-center">
 <div className="text-3xl font-bold tracking-tight">
 01:24:08
 </div>
 <p className="text-emerald-100 text-sm">Active session</p>
 </div>
 <div className="flex justify-center space-x-2">
 <Button size="sm" variant="outline" className="bg-card border-white/20 text-white hover:bg-card">
 <Pause className="h-3 w-3" />
 </Button>
 <Button size="sm" variant="outline" className="bg-card border-white/20 text-white hover:bg-card">
 <Square className="h-3 w-3" />
 </Button>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 </div>
 );
}