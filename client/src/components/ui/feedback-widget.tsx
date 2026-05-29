import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Star, Camera, Send, ThumbsUp, ThumbsDown, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

export interface FeedbackData {
 type: 'bug_report' | 'feature_request' | 'improvement' | 'general' | 'complaint' | 'compliment';
 category?: string;
 title: string;
 description: string;
 priority: 'low' | 'medium' | 'high' | 'urgent';
 rating?: number;
 pageUrl?: string;
 reproductionSteps?: string;
 expectedBehavior?: string;
 actualBehavior?: string;
}

interface FeedbackWidgetProps {
 children?: React.ReactNode;
 currentPage?: string;
 compact?: boolean;
}

export function FeedbackWidget({ children, currentPage, compact = false }: FeedbackWidgetProps) {
 const [isOpen, setIsOpen] = useState(false);
 const [feedback, setFeedback] = useState<Partial<FeedbackData>>({
 type: 'general',
 priority: 'medium',
 pageUrl: currentPage || window.location.pathname,
 });
 const [rating, setRating] = useState(0);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const { toast } = useToast();

 const handleSubmit = async () => {
 if (!feedback.title || !feedback.description) {
 toast({
 title: "Missing Information",
 description: "Please provide both a title and description for your feedback.",
 variant: "destructive",
 });
 return;
 }

 setIsSubmitting(true);
 try {
 // Collect browser and device info
 const browserInfo = {
 userAgent: navigator.userAgent,
 language: navigator.language,
 platform: navigator.platform,
 cookieEnabled: navigator.cookieEnabled,
 onLine: navigator.onLine,
 };

 const deviceInfo = {
 screenWidth: window.screen.width,
 screenHeight: window.screen.height,
 viewportWidth: window.innerWidth,
 viewportHeight: window.innerHeight,
 devicePixelRatio: window.devicePixelRatio,
 orientation: window.screen.orientation?.type,
 };

 const feedbackData = {
 ...feedback,
 rating: rating || undefined,
 browserInfo,
 deviceInfo,
 };

 await apiRequest('/api/user-feedback', {
 method: 'POST',
 data: feedbackData,
 });

 toast({
 title: "Feedback Submitted",
 description: "Thank you for your feedback! We'll review it and get back to you soon.",
 });

 // Reset form
 setFeedback({
 type: 'general',
 priority: 'medium',
 pageUrl: currentPage || window.location.pathname,
 });
 setRating(0);
 setIsOpen(false);
 } catch (error) {
 toast({
 title: "Submission Failed",
 description: "There was an error submitting your feedback. Please try again.",
 variant: "destructive",
 });
 } finally {
 setIsSubmitting(false);
 }
 };

 const getFeedbackTypeIcon = (type: string) => {
 switch (type) {
 case 'bug_report': return <AlertCircle className="w-4 h-4 text-red-500" />;
 case 'feature_request': return <Star className="w-4 h-4 text-blue-500" />;
 case 'improvement': return <ThumbsUp className="w-4 h-4 text-green-500" />;
 case 'complaint': return <ThumbsDown className="w-4 h-4 text-orange-500" />;
 case 'compliment': return <Star className="w-4 h-4 text-yellow-500" />;
 default: return <MessageSquare className="w-4 h-4 text-muted-foreground" />;
 }
 };

 const renderStarRating = () => (
 <div className="flex items-center gap-1">
 {[1, 2, 3, 4, 5].map((star) => (
 <button
 key={star}
 type="button"
 onClick={() => setRating(star)}
 className={`p-1 ${star <= rating ? 'text-yellow-500' : 'text-muted-foreground'} hover:text-yellow-400 transition-colors`}
 data-testid={`star-rating-${star}`}
 >
 <Star className="w-5 h-5 fill-current" />
 </button>
 ))}
 </div>
 );

 if (compact) {
 return (
 <Dialog open={isOpen} onOpenChange={setIsOpen}>
 <DialogTrigger asChild>
 {children || (
 <Button 
 variant="outline" 
 size="sm" 
 className="fixed bottom-4 right-4 z-50 shadow-lg"
 data-testid="feedback-trigger-compact"
 >
 <MessageSquare className="w-4 h-4 mr-2" />
 Feedback
 </Button>
 )}
 </DialogTrigger>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <MessageSquare className="w-5 h-5" />
 Quick Feedback
 </DialogTitle>
 </DialogHeader>
 <div className="space-y-4">
 <div className="grid grid-cols-2 gap-3">
 <Select value={feedback.type} onValueChange={(value) => setFeedback(prev => ({ ...prev, type: value as any }))}>
 <SelectTrigger data-testid="feedback-type-select">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="bug_report">🐛 Bug Report</SelectItem>
 <SelectItem value="feature_request">✨ Feature Request</SelectItem>
 <SelectItem value="improvement">📈 Improvement</SelectItem>
 <SelectItem value="compliment">👍 Compliment</SelectItem>
 <SelectItem value="complaint">👎 Complaint</SelectItem>
 <SelectItem value="general">💬 General</SelectItem>
 </SelectContent>
 </Select>
 <Select value={feedback.priority} onValueChange={(value) => setFeedback(prev => ({ ...prev, priority: value as any }))}>
 <SelectTrigger data-testid="feedback-priority-select">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="low">Low</SelectItem>
 <SelectItem value="medium">Medium</SelectItem>
 <SelectItem value="high">High</SelectItem>
 <SelectItem value="urgent">Urgent</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <Input
 placeholder="Brief title for your feedback"
 value={feedback.title || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, title: e.target.value }))}
 data-testid="feedback-title-input"
 />
 <Textarea
 placeholder="Describe your feedback in detail..."
 value={feedback.description || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, description: e.target.value }))}
 rows={3}
 data-testid="feedback-description-textarea"
 />
 {['compliment', 'complaint', 'general'].includes(feedback.type || '') && (
 <div>
 <Label className="text-sm font-medium mb-2 block">Rate your experience (optional)</Label>
 {renderStarRating()}
 </div>
 )}
 <Button 
 onClick={handleSubmit} 
 disabled={isSubmitting || !feedback.title || !feedback.description}
 className="w-full"
 data-testid="feedback-submit-button"
 >
 {isSubmitting ? 'Submitting...' : 'Send Feedback'}
 <Send className="w-4 h-4 ml-2" />
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 );
 }

 return (
 <Dialog open={isOpen} onOpenChange={setIsOpen}>
 <DialogTrigger asChild>
 {children || (
 <Button variant="outline" data-testid="feedback-trigger-full">
 <MessageSquare className="w-4 h-4 mr-2" />
 Share Feedback
 </Button>
 )}
 </DialogTrigger>
 <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <MessageSquare className="w-5 h-5" />
 Share Your Feedback
 </DialogTitle>
 </DialogHeader>
 <div className="space-y-6">
 {/* Feedback Type & Priority */}
 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label className="text-sm font-medium mb-2 block">Feedback Type</Label>
 <Select value={feedback.type} onValueChange={(value) => setFeedback(prev => ({ ...prev, type: value as any }))}>
 <SelectTrigger data-testid="feedback-type-select-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="bug_report">
 <div className="flex items-center gap-2">
 <AlertCircle className="w-4 h-4 text-red-500" />
 Bug Report
 </div>
 </SelectItem>
 <SelectItem value="feature_request">
 <div className="flex items-center gap-2">
 <Star className="w-4 h-4 text-blue-500" />
 Feature Request
 </div>
 </SelectItem>
 <SelectItem value="improvement">
 <div className="flex items-center gap-2">
 <ThumbsUp className="w-4 h-4 text-green-500" />
 Improvement
 </div>
 </SelectItem>
 <SelectItem value="compliment">
 <div className="flex items-center gap-2">
 <Star className="w-4 h-4 text-yellow-500" />
 Compliment
 </div>
 </SelectItem>
 <SelectItem value="complaint">
 <div className="flex items-center gap-2">
 <ThumbsDown className="w-4 h-4 text-orange-500" />
 Complaint
 </div>
 </SelectItem>
 <SelectItem value="general">
 <div className="flex items-center gap-2">
 <MessageSquare className="w-4 h-4 text-muted-foreground" />
 General
 </div>
 </SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div>
 <Label className="text-sm font-medium mb-2 block">Priority</Label>
 <Select value={feedback.priority} onValueChange={(value) => setFeedback(prev => ({ ...prev, priority: value as any }))}>
 <SelectTrigger data-testid="feedback-priority-select-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="low">Low Priority</SelectItem>
 <SelectItem value="medium">Medium Priority</SelectItem>
 <SelectItem value="high">High Priority</SelectItem>
 <SelectItem value="urgent">Urgent</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>

 {/* Title */}
 <div>
 <Label className="text-sm font-medium mb-2 block">Title</Label>
 <Input
 placeholder="Brief, descriptive title for your feedback"
 value={feedback.title || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, title: e.target.value }))}
 data-testid="feedback-title-input-full"
 />
 </div>

 {/* Category */}
 <div>
 <Label className="text-sm font-medium mb-2 block">Category (Optional)</Label>
 <Input
 placeholder="e.g., Dashboard, Reports, Mobile App"
 value={feedback.category || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, category: e.target.value }))}
 data-testid="feedback-category-input"
 />
 </div>

 {/* Description */}
 <div>
 <Label className="text-sm font-medium mb-2 block">Description</Label>
 <Textarea
 placeholder="Provide detailed information about your feedback..."
 value={feedback.description || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, description: e.target.value }))}
 rows={4}
 data-testid="feedback-description-textarea-full"
 />
 </div>

 {/* Bug Report Specific Fields */}
 {feedback.type === 'bug_report' && (
 <div className="space-y-4 p-4 bg-red-50 rounded-lg border">
 <h4 className="font-medium text-red-800">Bug Report Details</h4>
 <div>
 <Label className="text-sm font-medium mb-2 block">Steps to Reproduce</Label>
 <Textarea
 placeholder="1. Go to... 2. Click on... 3. See error..."
 value={feedback.reproductionSteps || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, reproductionSteps: e.target.value }))}
 rows={3}
 data-testid="feedback-reproduction-steps"
 />
 </div>
 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label className="text-sm font-medium mb-2 block">Expected Behavior</Label>
 <Textarea
 placeholder="What should happen?"
 value={feedback.expectedBehavior || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, expectedBehavior: e.target.value }))}
 rows={2}
 data-testid="feedback-expected-behavior"
 />
 </div>
 <div>
 <Label className="text-sm font-medium mb-2 block">Actual Behavior</Label>
 <Textarea
 placeholder="What actually happens?"
 value={feedback.actualBehavior || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, actualBehavior: e.target.value }))}
 rows={2}
 data-testid="feedback-actual-behavior"
 />
 </div>
 </div>
 </div>
 )}

 {/* Rating for applicable feedback types */}
 {['compliment', 'complaint', 'general', 'improvement'].includes(feedback.type || '') && (
 <div>
 <Label className="text-sm font-medium mb-2 block">
 Rate your experience (optional)
 </Label>
 {renderStarRating()}
 {rating > 0 && (
 <p className="text-sm text-muted-foreground mt-1">
 {rating === 1 && "Poor experience"}
 {rating === 2 && "Below average"}
 {rating === 3 && "Average experience"}
 {rating === 4 && "Good experience"}
 {rating === 5 && "Excellent experience"}
 </p>
 )}
 </div>
 )}

 {/* Current Page */}
 <div>
 <Label className="text-sm font-medium mb-2 block">Page/Location</Label>
 <Input
 value={feedback.pageUrl || ''}
 onChange={(e) => setFeedback(prev => ({ ...prev, pageUrl: e.target.value }))}
 placeholder="Current page or feature location"
 data-testid="feedback-page-url"
 />
 </div>

 {/* Submit Button */}
 <Button 
 onClick={handleSubmit} 
 disabled={isSubmitting || !feedback.title || !feedback.description}
 className="w-full"
 size="lg"
 data-testid="feedback-submit-button-full"
 >
 {isSubmitting ? 'Submitting Feedback...' : 'Submit Feedback'}
 <Send className="w-4 h-4 ml-2" />
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 );
}

// Quick feedback button for specific actions
export function QuickFeedbackButton({ 
 type, 
 context, 
 className = "" 
}: { 
 type: FeedbackData['type']; 
 context: string; 
 className?: string; 
}) {
 const [isSubmitting, setIsSubmitting] = useState(false);
 const { toast } = useToast();

 const handleQuickFeedback = async () => {
 setIsSubmitting(true);
 try {
 const feedbackData = {
 type,
 title: `Quick ${type.replace('_', ' ')} feedback`,
 description: `User provided quick feedback for: ${context}`,
 priority: 'low' as const,
 pageUrl: window.location.pathname,
 category: 'Quick Feedback',
 };

 await apiRequest('/api/user-feedback', {
 method: 'POST',
 body: JSON.stringify(feedbackData),
 });

 toast({
 title: "Thanks for the feedback!",
 description: "Your quick feedback has been recorded.",
 });
 } catch (error) {
 toast({
 title: "Error",
 description: "Failed to submit feedback. Please try again.",
 variant: "destructive",
 });
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <Button
 variant="ghost"
 size="sm"
 onClick={handleQuickFeedback}
 disabled={isSubmitting}
 className={`text-xs ${className}`}
 data-testid={`quick-feedback-${type}`}
 >
 {isSubmitting ? '...' : type === 'compliment' ? '👍' : type === 'complaint' ? '👎' : '💬'}
 </Button>
 );
}