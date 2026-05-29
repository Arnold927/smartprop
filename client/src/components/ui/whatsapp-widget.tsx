import React, { useState } from 'react';
import { MessageCircle, X, Send, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface WhatsAppWidgetProps {
 phoneNumber?: string;
 businessName?: string;
 defaultMessage?: string;
}

export default function WhatsAppWidget({ 
 phoneNumber = "+254759657590", 
 businessName = "Smart Prop Support",
 defaultMessage = "Hi! I'm interested in Smart Prop's property management solutions. Can you help me?"
}: WhatsAppWidgetProps) {
 const [isOpen, setIsOpen] = useState(false);
 const [message, setMessage] = useState(defaultMessage);
 const [name, setName] = useState("");
 const [phone, setPhone] = useState("");

 const handleSendWhatsApp = () => {
 let whatsappMessage = message;
 
 if (name || phone) {
 whatsappMessage = `Name: ${name}\nPhone: ${phone}\n\nMessage: ${message}`;
 }
 
 const encodedMessage = encodeURIComponent(whatsappMessage);
 const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}?text=${encodedMessage}`;
 
 window.open(whatsappUrl, '_blank');
 setIsOpen(false);
 };

 const quickMessages = [
 "I need help with property management",
 "I want to schedule a demo",
 "I have questions about pricing",
 "I need technical support"
 ];

 return (
 <>
 {/* WhatsApp Floating Button */}
 <div className="fixed bottom-6 right-6 z-50">
 {!isOpen && (
 <Button
 onClick={() => setIsOpen(true)}
 className="h-14 w-14 rounded-full bg-green-500 hover:bg-green-600 shadow-lg animate-bounce"
 size="icon"
 >
 <MessageCircle className="h-6 w-6 text-white" />
 </Button>
 )}

 {/* WhatsApp Chat Widget */}
 {isOpen && (
 <Card className="w-80 shadow-2xl border-0 animate-in slide-in-from-bottom-4 duration-300">
 {/* Header */}
 <CardHeader className="bg-green-500 text-white rounded-t-lg p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center space-x-3">
 <div className="w-10 h-10 bg-card bg-opacity-20 rounded-full flex items-center justify-center">
 <MessageCircle className="h-5 w-5" />
 </div>
 <div>
 <CardTitle className="text-lg font-semibold">
 {businessName}
 </CardTitle>
 <p className="text-sm text-green-100">
 Typically replies instantly
 </p>
 </div>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setIsOpen(false)}
 className="text-white hover:bg-card hover:bg-opacity-20"
 >
 <X className="h-4 w-4" />
 </Button>
 </div>
 </CardHeader>

 <CardContent className="p-4 space-y-4">
 {/* Welcome Message */}
 <div className="bg-muted rounded-lg p-3">
 <p className="text-sm text-foreground">
 👋 Hi there! How can we help you with Smart Prop property management today?
 </p>
 </div>

 {/* Quick Message Buttons */}
 <div className="space-y-2">
 <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
 Quick Messages
 </p>
 {quickMessages.map((quickMsg, index) => (
 <button
 key={index}
 onClick={() => setMessage(quickMsg)}
 className="w-full text-left p-2 text-sm bg-muted hover:bg-muted rounded border transition-colors"
 >
 {quickMsg}
 </button>
 ))}
 </div>

 {/* Contact Form */}
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-2">
 <Input
 placeholder="Your name"
 value={name}
 onChange={(e) => setName(e.target.value)}
 className="text-sm"
 />
 <Input
 placeholder="Your phone"
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 className="text-sm"
 />
 </div>
 
 <Textarea
 placeholder="Type your message..."
 value={message}
 onChange={(e) => setMessage(e.target.value)}
 className="text-sm min-h-[80px] resize-none"
 />

 <Button
 onClick={handleSendWhatsApp}
 className="w-full bg-green-500 hover:bg-green-600 text-white"
 disabled={!message.trim()}
 >
 <Send className="h-4 w-4 mr-2" />
 Send WhatsApp Message
 </Button>
 </div>

 {/* Direct Call Button */}
 <div className="border-t pt-3">
 <Button
 variant="outline"
 className="w-full"
 onClick={() => window.open(`tel:${phoneNumber}`, '_self')}
 >
 <Phone className="h-4 w-4 mr-2" />
 Call {phoneNumber}
 </Button>
 </div>

 {/* Business Hours */}
 <div className="text-xs text-muted-foreground text-center border-t pt-3">
 <p className="font-medium">Business Hours</p>
 <p>Mon-Fri: 8:00 AM - 6:00 PM (EAT)</p>
 <p>Sat: 9:00 AM - 2:00 PM</p>
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 </>
 );
}