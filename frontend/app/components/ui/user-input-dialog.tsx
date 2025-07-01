import React, { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Switch } from './switch';
import { Badge } from './badge';
import { Separator } from './separator';
import { Eye, EyeOff, Key, Mail, Phone, Link2, MessageSquare, Shield, SkipForward } from 'lucide-react';
import type { InputRequest, UserInputRequest } from '../../types/exploration';

interface UserInputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userInputRequest: UserInputRequest | null;
  onSubmit: (inputs: { [key: string]: string }) => void;
  onSkip: () => void;
}

export function UserInputDialog({ 
  isOpen, 
  onClose, 
  userInputRequest, 
  onSubmit,
  onSkip
}: UserInputDialogProps) {
  const [inputValues, setInputValues] = useState<{ [key: string]: string }>({});
  const [showPassword, setShowPassword] = useState<{ [key: string]: boolean }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens/closes or request changes
  useEffect(() => {
    if (userInputRequest && isOpen) {
      const initialValues: { [key: string]: string } = {};
      userInputRequest.inputs.forEach(input => {
        initialValues[input.inputKey] = input.inputType === 'boolean' ? 'false' : '';
      });
      setInputValues(initialValues);
      setShowPassword({});
    }
  }, [userInputRequest, isOpen]);

  const handleInputChange = (inputKey: string, value: string) => {
    setInputValues(prev => ({
      ...prev,
      [inputKey]: value
    }));
  };

  const handleBooleanChange = (inputKey: string, checked: boolean) => {
    setInputValues(prev => ({
      ...prev,
      [inputKey]: checked ? 'true' : 'false'
    }));
  };

  const togglePasswordVisibility = (inputKey: string) => {
    setShowPassword(prev => ({
      ...prev,
      [inputKey]: !prev[inputKey]
    }));
  };

  const handleSubmit = async () => {
    if (!userInputRequest) return;
    
    // Validate all required inputs
    const isValid = userInputRequest.inputs.every(input => {
      const value = inputValues[input.inputKey];
      return value && value.trim().length > 0;
    });

    if (!isValid) {
      alert('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(inputValues);
      // Don't call onClose() here - the dialog will close automatically 
      // when the backend clears userInputRequest from state after processing
    } catch (error) {
      console.error('Error submitting user input:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setIsSubmitting(true);
    try {
      await onSkip();
      // Dialog will close automatically when backend processes the skip
    } catch (error) {
      console.error('Error skipping user input:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getInputIcon = (inputType: string) => {
    switch (inputType) {
      case 'email': return <Mail className="w-4 h-4" />;
      case 'password': return <Key className="w-4 h-4" />;
      case 'phone': return <Phone className="w-4 h-4" />;
      case 'url': return <Link2 className="w-4 h-4" />;
      case 'otp': return <Key className="w-4 h-4" />;
      case 'boolean': return <MessageSquare className="w-4 h-4" />;
      default: return <MessageSquare className="w-4 h-4" />;
    }
  };

  if (!userInputRequest) return null;

  const isSingleInput = userInputRequest.inputs.length === 1;
  const hasMultipleInputs = userInputRequest.inputs.length > 1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            AI Agent Needs Your Input
          </DialogTitle>
          <DialogDescription className="text-sm">
            {isSingleInput 
              ? "The AI agent requires your input to continue exploration"
              : `The AI agent needs ${userInputRequest.inputs.length} pieces of information to continue`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current page context */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">
                Step {userInputRequest.stepNumber}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Current page: {new URL(userInputRequest.url).hostname}
              </span>
            </div>
          </div>

          {hasMultipleInputs && (
            <>
              <Separator />
              <div className="text-sm text-muted-foreground">
                Please provide all the following information:
              </div>
            </>
          )}

          {/* Input fields */}
          <div className="space-y-4">
            {userInputRequest.inputs.map((input, index) => (
              <div key={input.inputKey} className="space-y-2">
                <div className="flex items-center gap-2">
                  {getInputIcon(input.inputType)}
                  <Label 
                    htmlFor={input.inputKey} 
                    className="text-sm font-medium flex items-center gap-2"
                  >
                    {input.inputPrompt}
                  </Label>
                </div>

                {input.inputType === 'boolean' ? (
                  <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg">
                    <Switch
                      id={input.inputKey}
                      checked={inputValues[input.inputKey] === 'true'}
                      onCheckedChange={(checked) => handleBooleanChange(input.inputKey, checked)}
                    />
                    <Label htmlFor={input.inputKey} className="text-sm">
                      {inputValues[input.inputKey] === 'true' ? 'Yes' : 'No'}
                    </Label>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      id={input.inputKey}
                      type={
                        input.inputType === 'password' && !showPassword[input.inputKey] 
                          ? 'password' 
                          : input.inputType === 'email' 
                          ? 'email' 
                          : input.inputType === 'url'
                          ? 'url'
                          : input.inputType === 'phone'
                          ? 'tel'
                          : 'text'
                      }
                      value={inputValues[input.inputKey] || ''}
                      onChange={(e) => handleInputChange(input.inputKey, e.target.value)}
                      placeholder={
                        input.inputType === 'email' ? 'Enter your email address' :
                        input.inputType === 'password' ? 'Enter your password' :
                        input.inputType === 'phone' ? 'Enter phone number' :
                        input.inputType === 'url' ? 'https://example.com' :
                        input.inputType === 'otp' ? 'Enter verification code' :
                        'Enter value'
                      }
                      className="text-sm pr-10"
                      autoComplete={
                        input.inputType === 'email' ? 'email' :
                        input.inputType === 'password' ? 'current-password' :
                        'off'
                      }
                    />
                    
                    {input.inputType === 'password' && (
                      <button
                        type="button"
                        onClick={() => togglePasswordVisibility(input.inputKey)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword[input.inputKey] ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                )}

                {hasMultipleInputs && index < userInputRequest.inputs.length - 1 && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))}
          </div>

          {/* Security notice for password inputs */}
          {userInputRequest.inputs.some(input => input.inputType === 'password') && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
                <Shield className="w-4 h-4" />
                <span className="text-xs font-medium">Security Notice</span>
              </div>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                Your information is handled securely and only used for this exploration session.
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-2">
                <strong>Note:</strong> The AI will only use normal email/password login forms and will not attempt third-party authentication (Google, Facebook, etc.).
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-sm"
          >
            Cancel Exploration
          </Button>
          <Button
            variant="secondary"
            onClick={handleSkip}
            disabled={isSubmitting}
            className="text-sm gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Skipping...
              </>
            ) : (
              <>
                <SkipForward className="w-3 h-3" />
                Skip & Continue
              </>
            )}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="text-sm gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Shield className="w-3 h-3" />
                {isSingleInput ? 'Submit' : `Submit All (${userInputRequest.inputs.length})`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 