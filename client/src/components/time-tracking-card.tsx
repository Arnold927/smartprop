// components/time-tracking-card.tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, Building } from "lucide-react";
import { format } from "date-fns";

interface TimeTrackingCardProps {
 activeSession: any;
 onClockOut: () => void;
 isClockingOut: boolean;
}

export function TimeTrackingCard({ activeSession, onClockOut, isClockingOut }: TimeTrackingCardProps) {
 if (!activeSession) return null;

 return (
 <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
 <h3 className="font-semibold text-green-800">Currently Clocked In</h3>
 </div>
 
 <div className="grid grid-cols-2 gap-4 text-sm">
 <div>
 <p className="text-muted-foreground">Staff</p>
 <p className="font-medium">{activeSession.staff_name}</p>
 </div>
 <div>
 <p className="text-muted-foreground">Since</p>
 <p className="font-medium">
 {format(new Date(activeSession.clock_in_time), 'HH:mm')}
 </p>
 </div>
 <div>
 <p className="text-muted-foreground">Duration</p>
 <p className="font-medium">{activeSession.duration_hours}h</p>
 </div>
 <div>
 <p className="text-muted-foreground">Method</p>
 <p className="font-medium capitalize">{activeSession.clock_in_method}</p>
 </div>
 </div>
 
 {activeSession.property_name && (
 <div className="flex items-center gap-2 text-sm">
 <Building className="h-4 w-4 text-muted-foreground" />
 <span>{activeSession.property_name}</span>
 </div>
 )}
 </div>
 
 <Button
 onClick={onClockOut}
 disabled={isClockingOut}
 className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700"
 >
 <Clock className="mr-2 h-4 w-4" />
 {isClockingOut ? "Processing..." : "Clock Out"}
 </Button>
 </div>
 </CardContent>
 </Card>
 );
}