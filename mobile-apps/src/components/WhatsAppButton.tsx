import React, { useState, useEffect } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import WhatsAppService from '../services/whatsapp';

interface WhatsAppButtonProps {
  message?: string;
  style?: any;
  size?: 'small' | 'medium' | 'large';
  variant?: 'primary' | 'secondary' | 'emergency';
  onPress?: () => void;
}

const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({
  message,
  style,
  size = 'medium',
  variant = 'primary',
  onPress,
}) => {
  const [isWhatsAppInstalled, setIsWhatsAppInstalled] = useState(true);

  useEffect(() => {
    checkWhatsAppInstallation();
  }, []);

  const checkWhatsAppInstallation = async () => {
    const installed = await WhatsAppService.isWhatsAppInstalled();
    setIsWhatsAppInstalled(installed);
  };

  const handlePress = async () => {
    if (onPress) {
      onPress();
      return;
    }

    const success = await WhatsAppService.openWhatsAppChat(message);
    
    if (!success) {
      Alert.alert(
        'WhatsApp Not Available',
        'WhatsApp is not installed on this device. Please install WhatsApp or contact support directly.',
        [
          { text: 'OK', style: 'default' }
        ]
      );
    }
  };

  const getButtonStyle = () => {
    const baseStyle = [styles.button, styles[size]];
    
    switch (variant) {
      case 'emergency':
        return [...baseStyle, styles.emergency];
      case 'secondary':
        return [...baseStyle, styles.secondary];
      default:
        return [...baseStyle, styles.primary];
    }
  };

  const getTextStyle = () => {
    const baseStyle = [styles.text, styles[`${size}Text`]];
    
    switch (variant) {
      case 'emergency':
        return [...baseStyle, styles.emergencyText];
      case 'secondary':
        return [...baseStyle, styles.secondaryText];
      default:
        return [...baseStyle, styles.primaryText];
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'small': return 16;
      case 'large': return 24;
      default: return 20;
    }
  };

  return (
    <TouchableOpacity 
      style={[...getButtonStyle(), style]} 
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        <Icon 
          name="chat" 
          size={getIconSize()} 
          color={variant === 'secondary' ? '#25D366' : '#FFFFFF'} 
        />
        <Text style={getTextStyle()}>
          {variant === 'emergency' ? 'Emergency Support' : 'WhatsApp Support'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  
  // Size variants
  small: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  medium: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  large: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },

  // Color variants
  primary: {
    backgroundColor: '#25D366',
  },
  secondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#25D366',
  },
  emergency: {
    backgroundColor: '#EF4444',
  },

  // Text styles
  text: {
    fontWeight: '600',
  },
  smallText: {
    fontSize: 14,
  },
  mediumText: {
    fontSize: 16,
  },
  largeText: {
    fontSize: 18,
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: '#25D366',
  },
  emergencyText: {
    color: '#FFFFFF',
  },
});

export default WhatsAppButton;