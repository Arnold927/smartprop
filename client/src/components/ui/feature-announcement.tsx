import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { X, Play, ExternalLink, Heart, Eye, Star, Sparkles, Zap, Megaphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface FeatureAnnouncement {
 id: number;
 title: string;
 description: string;
 content?: string;
 featureId?: string;
 category?: string;
 status: 'new' | 'announced' | 'beta' | 'stable' | 'deprecated';
 priority: 'low' | 'medium' | 'high' | 'urgent';
 targetAudience: string[];
 releaseDate?: string;
 announcementDate?: string;
 imageUrl?: string;
 videoUrl?: string;
 demoUrl?: string;
 documentationUrl?: string;
 changelogUrl?: string;
 isActive: boolean;
 showAsTooltip: boolean;
 showAsModal: boolean;
 showAsBanner: boolean;
 displayDuration: number;
 viewsCount: number;
 clicksCount: number;
 dismissalsCount: number;
 likesCount: number;
 createdAt: string;
 updatedAt: string;
}

interface FeatureAnnouncementProps {
 userRole?: string;
 position?: 'banner' | 'modal' | 'tooltip' | 'sidebar';
 maxAnnouncements?: number;
}

export function FeatureAnnouncementCenter({ userRole = 'manager', position = 'modal', maxAnnouncements = 5 }: FeatureAnnouncementProps) {
 const [selectedAnnouncement, setSelectedAnnouncement] = useState<FeatureAnnouncement | null>(null);
 const [dismissedIds, setDismissedIds] = useState<number[]>([]);
 const { toast } = useToast();
 const queryClient = useQueryClient();

 // Load dismissed announcements from localStorage
 useEffect(() => {
 const dismissed = localStorage.getItem('dismissedAnnouncements');
 if (dismissed) {
 setDismissedIds(JSON.parse(dismissed));
 }
 }, []);

 // Fetch active feature announcements
 const { data: announcements = [], isLoading } = useQuery<FeatureAnnouncement[]>({
  queryKey: ['/api/feature-announcements', userRole],
  staleTime: 5 * 60 * 1000,
});

 // Track interaction with announcement
 const trackInteraction = useMutation({
 mutationFn: async ({ announcementId, interactionType, data }: {
 announcementId: number;
 interactionType: 'viewed' | 'clicked' | 'dismissed' | 'liked' | 'shared';
 data?: any;
 }) => {
 return apiRequest('/api/feature-interactions', {
 method: 'POST',
 data: {
    featureAnnouncementId: announcementId,
    interactionType,
    interactionData: data,
    deviceType: window.innerWidth < 768 ? 'mobile' : 'desktop',
    sessionId: sessionStorage.getItem('sessionId') || 'anonymous',
  },
 });
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['/api/feature-announcements'] });
 },
 });

 const handleDismiss = (announcementId: number) => {
 const newDismissedIds = [...dismissedIds, announcementId];
 setDismissedIds(newDismissedIds);
 localStorage.setItem('dismissedAnnouncements', JSON.stringify(newDismissedIds));
 trackInteraction.mutate({ announcementId, interactionType: 'dismissed' });
 };

 const handleView = (announcement: FeatureAnnouncement) => {
 setSelectedAnnouncement(announcement);
 trackInteraction.mutate({ announcementId: announcement.id, interactionType: 'viewed' });
 };

 const handleLike = (announcementId: number) => {
 trackInteraction.mutate({ announcementId, interactionType: 'liked' });
 toast({ title: "Thanks for the feedback!", description: "We're glad you like this feature." });
 };

 const handleClick = (announcement: FeatureAnnouncement, url: string) => {
 trackInteraction.mutate({ 
 announcementId: announcement.id, 
 interactionType: 'clicked',
 data: { url, linkType: url.includes('demo') ? 'demo' : url.includes('docs') ? 'documentation' : 'external' }
 });
 window.open(url, '_blank');
 };

 if (isLoading) return null;

 const activeAnnouncements = (announcements || [])
 .filter((announcement: FeatureAnnouncement) => {
 // Filter by user role
 if (!announcement.targetAudience.includes(userRole) && !announcement.targetAudience.includes('all')) {
 return false;
 }
 
 // Filter by dismissed status
 if (dismissedIds.includes(announcement.id)) {
 return false;
 }
 
 // Filter by display duration
 const announcementDate = new Date(announcement.announcementDate || announcement.createdAt);
 const daysSinceAnnouncement = (Date.now() - announcementDate.getTime()) / (1000 * 60 * 60 * 24);
 if (daysSinceAnnouncement > announcement.displayDuration) {
 return false;
 }
 
 return announcement.isActive;
 })
 .slice(0, maxAnnouncements);

 const getStatusIcon = (status: string) => {
 switch (status) {
 case 'new': return <Sparkles className="w-4 h-4 text-green-500" />;
 case 'beta': return <Zap className="w-4 h-4 text-orange-500" />;
 case 'announced': return <Megaphone className="w-4 h-4 text-blue-500" />;
 default: return <Star className="w-4 h-4 text-muted-foreground" />;
 }
 };

 const getStatusColor = (status: string) => {
    switch (status) {
      case 'new':        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'beta':       return 'bg-orange-50 text-orange-700 border border-orange-200';
      case 'announced':  return 'bg-blue-50 text-blue-700 border border-blue-200';
      case 'stable':     return 'bg-gray-100 text-gray-700 border border-gray-200';
      case 'deprecated': return 'bg-red-50 text-red-700 border border-red-200';
      default:           return 'bg-gray-100 text-gray-700 border border-gray-200';
    }
  };

  if (activeAnnouncements.length === 0) return null;

  const announcement = activeAnnouncements[0];

  // Banner position
  if (position === 'banner') {
    return (
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-3 relative" data-testid="feature-banner">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5" />
            <div>
              <span className="font-medium">{announcement.title}</span>
              <span className="ml-2 text-blue-100">{announcement.description}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {announcement.demoUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleClick(announcement, announcement.demoUrl!)}
                data-testid="banner-demo-button"
              >
                Try Demo
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(announcement)}
              data-testid="banner-learn-more"
            >
              Learn More
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDismiss(announcement.id)}
              data-testid="banner-dismiss"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

 // Sidebar position (list of announcements)
 if (position === 'sidebar') {
 return (
 <Card className="w-full" data-testid="feature-sidebar">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-sm">
 <Sparkles className="w-4 h-4 text-blue-500" />
 What's New
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 {activeAnnouncements.map((announcement:any) => (
 <div
 key={announcement.id}
 className="p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted transition-colors"
 onClick={() => handleView(announcement)}
 data-testid={`sidebar-announcement-${announcement.id}`}
 >
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-1">
 {getStatusIcon(announcement.status)}
 <Badge variant="outline" className={`text-xs ${getStatusColor(announcement.status)}`}>
 {announcement.status}
 </Badge>
 </div>
 <h4 className="font-medium text-sm line-clamp-2">{announcement.title}</h4>
 <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{announcement.description}</p>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={(e) => {
 e.stopPropagation();
 handleDismiss(announcement.id);
 }}
 className="shrink-0 p-1 h-auto"
 data-testid={`sidebar-dismiss-${announcement.id}`}
 >
 <X className="w-3 h-3" />
 </Button>
 </div>
 </div>
 ))}
 {activeAnnouncements.length === 0 && (
 <p className="text-sm text-muted-foreground text-center py-4">No new features to announce</p>
 )}
 </CardContent>
 </Card>
 );
 }

 // Modal position (detailed view)
 return (
 <>
 {/* Announcement Detail Modal */}
 <Dialog open={!!selectedAnnouncement} onOpenChange={(open) => !open && setSelectedAnnouncement(null)}>
 <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="feature-modal">
 {selectedAnnouncement && (
 <>
 <DialogHeader>
 <div className="flex items-start justify-between">
 <div className="flex items-center gap-3">
 {getStatusIcon(selectedAnnouncement.status)}
 <div>
 <DialogTitle className="text-xl">{selectedAnnouncement.title}</DialogTitle>
 <div className="flex items-center gap-2 mt-1">
 <Badge className={getStatusColor(selectedAnnouncement.status)}>
 {selectedAnnouncement.status}
 </Badge>
 {selectedAnnouncement.category && (
 <Badge variant="outline">{selectedAnnouncement.category}</Badge>
 )}
 </div>
 </div>
 </div>
 </div>
 </DialogHeader>
 
 <div className="space-y-6">
 {/* Feature Image */}
 {selectedAnnouncement.imageUrl && (
 <div className="rounded-lg overflow-hidden">
 <img 
 src={selectedAnnouncement.imageUrl} 
 alt={selectedAnnouncement.title}
 className="w-full h-auto"
 data-testid="feature-image"
 />
 </div>
 )}

 {/* Description */}
 <div>
 <p className="text-foreground leading-relaxed">{selectedAnnouncement.description}</p>
 </div>

 {/* Detailed Content */}
 {selectedAnnouncement.content && (
 <div className="prose prose-sm max-w-none">
 <div dangerouslySetInnerHTML={{ __html: selectedAnnouncement.content }} />
 </div>
 )}

 {/* Action Buttons */}
 <div className="flex items-center gap-3 pt-4 border-t">
 {selectedAnnouncement.demoUrl && (
 <Button
 onClick={() => handleClick(selectedAnnouncement, selectedAnnouncement.demoUrl!)}
 data-testid="modal-demo-button"
 >
 <Play className="w-4 h-4 mr-2" />
 Try Demo
 </Button>
 )}
 
 {selectedAnnouncement.documentationUrl && (
 <Button
 variant="outline"
 onClick={() => handleClick(selectedAnnouncement, selectedAnnouncement.documentationUrl!)}
 data-testid="modal-docs-button"
 >
 <ExternalLink className="w-4 h-4 mr-2" />
 Documentation
 </Button>
 )}
 
 <Button
 variant="ghost"
 onClick={() => handleLike(selectedAnnouncement.id)}
 className="ml-auto"
 data-testid="modal-like-button"
 >
 <Heart className="w-4 h-4 mr-2" />
 Like ({selectedAnnouncement.likesCount})
 </Button>
 </div>

 {/* Stats */}
 <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
 <span className="flex items-center gap-1">
 <Eye className="w-4 h-4" />
 {selectedAnnouncement.viewsCount} views
 </span>
 <span>Released {new Date(selectedAnnouncement.releaseDate || selectedAnnouncement.createdAt).toLocaleDateString()}</span>
 </div>
 </div>
 </>
 )}
 </DialogContent>
 </Dialog>
 </>
 );
}

// Tooltip component for new features
export function FeatureTooltip({ 
 featureId, 
 children, 
 title, 
 description 
}: { 
 featureId: string; 
 children: React.ReactNode; 
 title: string; 
 description: string; 
}) {
 const [hasViewed, setHasViewed] = useState(false);

 useEffect(() => {
 const viewedFeatures = JSON.parse(localStorage.getItem('viewedFeatures') || '[]');
 setHasViewed(viewedFeatures.includes(featureId));
 }, [featureId]);

 const handleView = () => {
 if (!hasViewed) {
 const viewedFeatures = JSON.parse(localStorage.getItem('viewedFeatures') || '[]');
 viewedFeatures.push(featureId);
 localStorage.setItem('viewedFeatures', JSON.stringify(viewedFeatures));
 setHasViewed(true);
 }
 };

 if (hasViewed) {
 return <>{children}</>;
 }

 return (
 <Tooltip>
 <TooltipTrigger asChild onMouseEnter={handleView} data-testid={`feature-tooltip-${featureId}`}>
 <div className="relative">
 {children}
 <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
 </div>
 </TooltipTrigger>
 <TooltipContent side="bottom" className="max-w-sm">
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Sparkles className="w-4 h-4 text-blue-500" />
 <span className="font-medium text-blue-600">New!</span>
 </div>
 <p className="font-medium">{title}</p>
 <p className="text-sm text-muted-foreground">{description}</p>
 </div>
 </TooltipContent>
 </Tooltip>
 );
}