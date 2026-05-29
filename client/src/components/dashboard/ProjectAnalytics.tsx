import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Plus, User } from 'lucide-react';

export function ProjectAnalytics() {
 return (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Project Analytics Chart */}
 <Card>
 <CardHeader>
 <CardTitle className="text-lg font-semibold">Project Analytics</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {/* Chart Placeholder - Donezo Style Bar Chart */}
 <div className="flex items-end justify-center h-32 space-x-2">
 {[
 { height: 20, color: 'bg-gray-300', pattern: true },
 { height: 45, color: 'bg-emerald-500', pattern: false },
 { height: 38, color: 'bg-emerald-400', pattern: false },
 { height: 55, color: 'bg-emerald-600', pattern: false },
 { height: 25, color: 'bg-gray-300', pattern: true },
 { height: 40, color: 'bg-gray-300', pattern: true },
 ].map((bar, index) => (
 <div
 key={index}
 className={`w-8 rounded-t-sm ${bar.color} ${
 bar.pattern ? 'bg-stripes' : ''
 }`}
 style={{ height: `${bar.height}%` }}
 />
 ))}
 </div>
 <div className="flex justify-center space-x-6 text-xs text-muted-foreground">
 <span>Jan</span>
 <span>Feb</span>
 <span>Mar</span>
 <span>Apr</span>
 <span>May</span>
 <span>Jun</span>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Reminders & Projects */}
 <div className="space-y-6">
 {/* Reminders */}
 <Card>
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <CardTitle className="text-lg font-semibold">Reminders</CardTitle>
 </div>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200' >
 <h4 className="font-medium text-emerald-900">Meeting with Arc Company</h4>
 <p className="text-sm text-emerald-700 mt-1">Time: 10:00 pm - 04:00 pm</p>
 <Button size="sm" className="mt-2 bg-emerald-600 hover:bg-emerald-700">
 <Calendar className="h-3 w-3 mr-1" />
 Start Meeting
 </Button>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Project Tasks */}
 <Card>
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <CardTitle className="text-lg font-semibold">Project</CardTitle>
 <Button size="sm" variant="outline">
 <Plus className="h-3 w-3 mr-1" />
 New
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 {[
 { title: 'Develop API Endpoints', status: 'Due date: Nov 28, 2024', color: 'blue' },
 { title: 'Onboarding Flow', status: 'Due date: Nov 19, 2024', color: 'orange' },
 { title: 'Build Dashboard', status: 'Due date: Nov 20, 2024', color: 'green' },
 { title: 'Optimize Page Load', status: 'Due date: Nov 30, 2024', color: 'yellow' },
 { title: 'Cross Browser Testing', status: 'Due date: Dec 2, 2024', color: 'purple' },
 ].map((project, index) => (
 <div key={index} className="flex items-center space-x-3">
 <div className={`w-2 h-2 rounded-full bg-${project.color}-500`} />
 <div className="flex-1">
 <p className="text-sm font-medium text-foreground">{project.title}</p>
 <p className="text-xs text-muted-foreground">{project.status}</p>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 </div>
 </div>
 );
}