import { Linking } from 'react-native';
import { MOBILE_CONFIG } from './config';

export class WhatsAppService {
  private static phoneNumber = MOBILE_CONFIG.WHATSAPP_NUMBER;
  private static businessName = MOBILE_CONFIG.BUSINESS_NAME;

  /**
   * Open WhatsApp with a pre-filled message
   */
  static async openWhatsAppChat(message?: string) {
    const defaultMessage = message || `Hi! I need help with my Smart Prop account. Can you assist me?`;
    const url = `whatsapp://send?phone=${this.phoneNumber}&text=${encodeURIComponent(defaultMessage)}`;
    
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return true;
      } else {
        // Fallback to web WhatsApp
        const webUrl = `https://wa.me/${this.phoneNumber.replace('+', '')}?text=${encodeURIComponent(defaultMessage)}`;
        await Linking.openURL(webUrl);
        return true;
      }
    } catch (error) {
      console.error('Error opening WhatsApp:', error);
      return false;
    }
  }

  /**
   * Open WhatsApp for property-related support
   */
  static async contactPropertySupport(propertyName?: string, issue?: string) {
    const message = propertyName && issue 
      ? `Hi! I need help with ${propertyName}. Issue: ${issue}. Can you assist me?`
      : `Hi! I need help with a property management issue. Can you assist me?`;
    
    return this.openWhatsAppChat(message);
  }

  /**
   * Open WhatsApp for maintenance support
   */
  static async contactMaintenanceSupport(maintenanceId?: string, description?: string) {
    const message = maintenanceId 
      ? `Hi! I need help with maintenance request #${maintenanceId}. ${description ? `Issue: ${description}` : ''}. Can you assist me?`
      : `Hi! I need help with a maintenance request. Can you assist me?`;
    
    return this.openWhatsAppChat(message);
  }

  /**
   * Open WhatsApp for tenant support
   */
  static async contactTenantSupport(tenantName?: string, issue?: string) {
    const message = tenantName && issue
      ? `Hi! I need help with tenant ${tenantName}. Issue: ${issue}. Can you assist me?`
      : `Hi! I need help with a tenant-related issue. Can you assist me?`;
    
    return this.openWhatsAppChat(message);
  }

  /**
   * Open WhatsApp for emergency support
   */
  static async contactEmergencySupport(emergencyType?: string, location?: string) {
    const message = emergencyType && location
      ? `🚨 EMERGENCY: ${emergencyType} at ${location}. Please assist immediately!`
      : `🚨 EMERGENCY: I need immediate assistance with a property emergency!`;
    
    return this.openWhatsAppChat(message);
  }

  /**
   * Check if WhatsApp is installed
   */
  static async isWhatsAppInstalled(): Promise<boolean> {
    try {
      const url = 'whatsapp://send';
      return await Linking.canOpenURL(url);
    } catch {
      return false;
    }
  }
}

export default WhatsAppService;