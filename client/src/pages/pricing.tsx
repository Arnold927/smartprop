import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Star, Users, Building2, TrendingUp, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

export default function Pricing() {
 const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");

 const plans = [
 {
 name: "Basic",
 description: "Perfect Plan for Starters",
 price: billingPeriod === "monthly" ? "Free" : "Free",
 period: "",
 color: "bg-blue-500",
 textColor: "text-white",
 popular: false,
 features: [
 "Rent Collection through various channels",
 "Tenant Management and Communication",
 "Basic reporting and analytics",
 "Billing management with automated invoices",
 "Online rent payment processing",
 "Bulk SMS tenant communication"
 ]
 },
 {
 name: "Premium",
 description: "Collaborate Professionally",
 price: billingPeriod === "monthly" ? "$29" : "$290",
 period: billingPeriod === "monthly" ? "/month" : "/year",
 color: "bg-slate-800",
 textColor: "text-white",
 popular: true,
 features: [
 "Everything in Basic, plus:",
 "Everything in Basic plan",
 "Regular property inspections",
 "Preventive & required maintenance",
 "Insurance claims management",
 "Effective tenants arrears handling",
 "Complete property/tenant management",
 "Complete tenant relationship management"
 ]
 },
 {
 name: "Enterprise",
 description: "One Month's Rent",
 price: "Custom",
 period: "pricing",
 color: "bg-gradient-to-br from-blue-500 to-purple-600",
 textColor: "text-white",
 popular: false,
 features: [
 "All Basic and Premium competitive tenant placement services aligned with traditional market rates in your area",
 "One month's rent fee (as new tenant placement)",
 "Comprehensive property marketing",
 "Professional photos & marketing process",
 "Lease preparation and management",
 "No renewal fees for existing tenants",
 "Quick and efficient tenant sourcing"
 ]
 }
 ];

 const differentiators = [
 {
 title: "No Renewal Fees",
 description: "Unlike many property management companies, there's no additional charge when your current tenants renew their lease—one less cost to worry about your investment."
 },
 {
 title: "Comprehensive Services", 
 description: "From tenant placement to maintenance coordination, our solutions allow you to choose the service level that best fits your needs."
 }
 ];

 return (
 <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
 {/* Header */}
 <header className="bg-card dark:bg-slate-800 shadow-sm">
 <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
 <div className="flex justify-between items-center py-6">
 <div className="flex items-center space-x-3">
 <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
 <Building2 className="h-6 w-6 text-white" />
 </div>
 <div>
 <h1 className="text-2xl font-semibold text-foreground">Smart Prop</h1>
 <p className="text-sm text-muted-foreground">Property Management Solutions</p>
 </div>
 </div>
 <div className="flex items-center space-x-4">
 <Link href="/">
 <Button variant="ghost" size="sm">
 <ArrowLeft className="w-4 h-4 mr-2" />
 Back to Home
 </Button>
 </Link>
 <Button onClick={() => window.location.href = '/auth'}>
 Sign In
 </Button>
 </div>
 </div>
 </div>
 </header>

 {/* Hero Section */}
 <div className="container mx-auto px-4 py-20">
 <div className="text-center mb-16">
 <div className="flex justify-center mb-8">
 <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center">
 <Building2 className="w-10 h-10 text-white" />
 </div>
 </div>
 <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
 Simple & Transparent
 <br />
 <span className="text-blue-500">Pricing</span>
 </h1>
 <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
 Our pricing is tailored to your property portfolio. Choose the plan that suits
 your needs and only pay for what you use.
 </p>
 
 {/* Billing Toggle */}
 <div className="flex items-center justify-center mb-8">
 <div className="bg-card dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700" >
 <button
 onClick={() => setBillingPeriod("monthly")}
 className={`px-4 py-2 rounded-md transition-all ${
 billingPeriod === "monthly"
 ? "bg-blue-500 text-white shadow-sm"
 : "text-muted-foreground hover:text-foreground"
 }`}
 >
 Monthly
 </button>
 <button
 onClick={() => setBillingPeriod("yearly")}
 className={`px-4 py-2 rounded-md transition-all ${
 billingPeriod === "yearly"
 ? "bg-blue-500 text-white shadow-sm"
 : "text-muted-foreground hover:text-foreground"
 }`}
 >
 Yearly
 <span className="ml-2 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">Save 17%</span>
 </button>
 </div>
 </div>
 </div>

 {/* Pricing Plans */}
 <div className="mb-16">
 <div className="text-center mb-12">
 <p className="text-sm text-muted-foreground mb-2">OUR PRICING</p>
 <h2 className="text-3xl font-bold text-blue-500 mb-4">PRICING PLANS</h2>
 <p className="text-muted-foreground">
 Choose the plan that's right for you. We offer different pricing models for landlords
 and property managers.
 </p>
 </div>

 {/* Plan Categories */}
 <div className="flex justify-center mb-8">
 <div className="flex items-center space-x-8">
 <div className="flex items-center space-x-2">
 <Users className="w-5 h-5 text-muted-foreground" />
 <span className="text-sm text-muted-foreground">For Landlords</span>
 </div>
 <div className="flex items-center space-x-2">
 <Building2 className="w-5 h-5 text-muted-foreground" />
 <span className="text-sm text-muted-foreground">For Property Managers</span>
 </div>
 </div>
 </div>

 <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
 {plans.map((plan, index) => (
 <Card 
 key={plan.name} 
 className={`relative overflow-hidden transition-all duration-300 hover:shadow-xl ${
 plan.popular ? "ring-2 ring-blue-500 scale-105" : ""
 }`}
 >
 {plan.popular && (
 <div className="absolute top-0 left-1/2 transform -translate-x-1/2">
 <Badge className="bg-blue-500 text-white px-4 py-1 rounded-b-md">
 BEST SELLER
 </Badge>
 </div>
 )}
 
 <CardHeader className={`${plan.color} ${plan.textColor} text-center pt-8`}>
 <div className="w-12 h-12 mx-auto mb-4 bg-card rounded-full flex items-center justify-center">
 {index === 0 && <Check className="w-6 h-6" />}
 {index === 1 && <Star className="w-6 h-6" />}
 {index === 2 && <TrendingUp className="w-6 h-6" />}
 </div>
 <CardTitle className="text-xl font-semibold mb-2">{plan.name}</CardTitle>
 <CardDescription className={`${plan.textColor} opacity-90 mb-4`}>
 {plan.description}
 </CardDescription>
 <div className="text-center">
 <span className="text-4xl font-bold">{plan.price}</span>
 <span className="text-lg opacity-80">{plan.period}</span>
 </div>
 </CardHeader>

 <CardContent className="pt-6 pb-8">
 <ul className="space-y-3">
 {plan.features.map((feature, idx) => (
 <li key={idx} className="flex items-start space-x-3">
 <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
 <span className="text-sm text-muted-foreground">{feature}</span>
 </li>
 ))}
 </ul>
 </CardContent>

 <CardFooter>
 <Button 
 className={`w-full ${
 plan.popular 
 ? "bg-blue-500 hover:bg-blue-600 text-white" 
 : "bg-slate-100 hover:bg-slate-200 text-foreground dark:bg-slate-800 dark:hover:bg-slate-700 "
 }`}
 size="lg"
 >
 {plan.name === "Basic" ? "Get Started Free" : 
 plan.name === "Enterprise" ? "Contact Sales" : "Start Free Trial"}
 </Button>
 </CardFooter>
 </Card>
 ))}
 </div>
 </div>

 {/* What Makes Smart Prop Different */}
 <div className="mb-16">
 <h3 className="text-2xl font-semibold text-center text-foreground mb-12">
 What makes Smart Prop different?
 </h3>
 <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
 {differentiators.map((item, index) => (
 <div key={index} className="text-center">
 <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
 <Check className="w-6 h-6 text-blue-500" />
 </div>
 <h4 className="text-lg font-semibold text-foreground mb-3">
 {item.title}
 </h4>
 <p className="text-muted-foreground text-sm leading-relaxed">
 {item.description}
 </p>
 </div>
 ))}
 </div>
 </div>

 {/* FAQ Section */}
 <div className="text-center mb-16">
 <h3 className="text-2xl font-semibold text-foreground mb-4">
 Frequently Asked Questions
 </h3>
 <p className="text-muted-foreground mb-8">
 Answers to Your Most Common Questions about Smart Prop's Property Management
 Solutions
 </p>
 <div className="max-w-2xl mx-auto">
 <Card className="p-6 text-left">
 <h4 className="font-semibold text-foreground mb-2">
 What is Smart Prop?
 </h4>
 <p className="text-muted-foreground text-sm">
 Smart Prop is a comprehensive property management platform that helps landlords and property managers streamline their operations with features like rent collection, tenant management, maintenance tracking, and automated communications.
 </p>
 </Card>
 </div>
 </div>

 {/* CTA Section */}
 <div className="text-center">
 <div className="bg-slate-800 dark:bg-slate-700 rounded-2xl p-8 max-w-4xl mx-auto">
 <h3 className="text-2xl font-semibold text-white mb-4">
 Ready for The Smart Prop Experience?
 </h3>
 <p className="text-slate-300 mb-6">
 We are here to help!
 </p>
 <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
 <div className="flex items-center space-x-2 text-slate-300">
 <div className="w-2 h-2 bg-green-500 rounded-full"></div>
 <span className="text-sm">24/7 Support Live</span>
 </div>
 <div className="flex items-center space-x-2 text-slate-300">
 <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
 <span className="text-sm">help@smartprop.com</span>
 </div>
 <Button className="bg-blue-500 hover:bg-blue-600 text-white">
 Get Started
 </Button>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}