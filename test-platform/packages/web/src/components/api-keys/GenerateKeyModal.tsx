'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, CheckCircle2, Info } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { SCOPE_DESCRIPTIONS, EXPIRATION_OPTIONS, type APIKeyScope, type CreateAPIKeyRequest } from '@/types/api-key.types';

const createKeySchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name too long'),
  description: z.string().max(255, 'Description too long').optional(),
  scopes: z.array(z.string()).min(1, 'Select at least one scope'),
  rateLimit: z.number().min(100).max(10000),
  expiresIn: z.number().optional(),
  ipWhitelist: z.string().optional(),
});

type FormData = z.infer<typeof createKeySchema>;

interface GenerateKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (data: CreateAPIKeyRequest) => Promise<void>;
}

export const GenerateKeyModal: React.FC<GenerateKeyModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
}) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(createKeySchema),
    defaultValues: {
      name: '',
      description: '',
      scopes: [],
      rateLimit: 1000,
      expiresIn: 365,
      ipWhitelist: '',
    },
  });

  const formData = watch();
  const selectedScopes = watch('scopes') as APIKeyScope[];

  const handleClose = () => {
    reset();
    setStep(1);
    onClose();
  };

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const ipWhitelist = data.ipWhitelist
        ? data.ipWhitelist.split('\n').filter((ip) => ip.trim())
        : undefined;

      await onGenerate({
        name: data.name,
        description: data.description,
        scopes: data.scopes as APIKeyScope[],
        rateLimit: data.rateLimit,
        expiresIn: data.expiresIn,
        ipWhitelist,
      });
      handleClose();
    } catch (error) {
      console.error('Failed to generate key:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleScope = (scope: APIKeyScope) => {
    const current = selectedScopes || [];
    if (current.includes(scope)) {
      setValue('scopes', current.filter((s) => s !== scope) as any);
    } else {
      setValue('scopes', [...current, scope] as any);
    }
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, 4));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Generate API Key" size="lg">
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center flex-1">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                    s <= step
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-300 bg-white text-gray-400'
                  }`}
                >
                  {s < step ? <CheckCircle2 className="w-5 h-5" /> : s}
                </div>
                {s < 4 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      s < step ? 'bg-primary-600' : 'bg-gray-300'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-600">
            <span>Configuration</span>
            <span>Permissions</span>
            <span>Security</span>
            <span>Review</span>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Key Name <span className="text-red-500">*</span>
              </label>
              <input
                {...register('name')}
                type="text"
                className="input"
                placeholder="e.g., Production API Key"
                autoFocus
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (Optional)
              </label>
              <textarea
                {...register('description')}
                className="input"
                rows={3}
                placeholder="Describe the purpose of this key"
                maxLength={255}
              />
              {errors.description && (
                <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {formData.description?.length || 0}/255 characters
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Scopes <span className="text-red-500">*</span>
              </label>
              <div className="space-y-3">
                {Object.entries(SCOPE_DESCRIPTIONS).map(([scope, description]) => (
                  <label
                    key={scope}
                    className="flex items-start p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes?.includes(scope as APIKeyScope)}
                      onChange={() => toggleScope(scope as APIKeyScope)}
                      className="mt-1 mr-3 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded">{scope}</code>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{description}</div>
                    </div>
                  </label>
                ))}
              </div>
              {errors.scopes && (
                <p className="mt-2 text-sm text-red-600">{errors.scopes.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rate Limit (requests per hour)
              </label>
              <input
                {...register('rateLimit', { valueAsNumber: true })}
                type="range"
                min="100"
                max="10000"
                step="100"
                className="w-full"
              />
              <div className="flex justify-between text-sm text-gray-600 mt-2">
                <span>100</span>
                <span className="font-semibold">{formData.rateLimit}</span>
                <span>10,000</span>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Expiration
              </label>
              <div className="grid grid-cols-2 gap-3">
                {EXPIRATION_OPTIONS.map((option) => (
                  <label
                    key={option.label}
                    className="flex items-center p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="radio"
                      {...register('expiresIn', { valueAsNumber: true })}
                      value={option.value}
                      className="mr-3 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-900">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                IP Whitelist (Optional)
              </label>
              <textarea
                {...register('ipWhitelist')}
                className="input font-mono text-xs"
                rows={5}
                placeholder="Enter one IP address or CIDR range per line"
              />
              <div className="mt-2 flex items-start text-xs text-gray-500">
                <Info className="w-4 h-4 mr-1 flex-shrink-0 mt-0.5" />
                <span>
                  Enter one IP address or CIDR range per line. Leave empty to allow all IPs.
                </span>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <Info className="w-5 h-5 text-yellow-600 mr-3 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-800">
                  <p className="font-semibold mb-1">Security Notice</p>
                  <p>
                    The full API key will only be shown once. Make sure to copy and store it
                    securely.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-gray-500">Key Name</div>
                <div className="mt-1 text-sm text-gray-900">{formData.name}</div>
              </div>

              {formData.description && (
                <div>
                  <div className="text-sm font-medium text-gray-500">Description</div>
                  <div className="mt-1 text-sm text-gray-900">{formData.description}</div>
                </div>
              )}

              <div>
                <div className="text-sm font-medium text-gray-500 mb-2">Scopes</div>
                <div className="flex flex-wrap gap-2">
                  {selectedScopes?.map((scope) => (
                    <Badge key={scope} variant="info">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-500">Rate Limit</div>
                <div className="mt-1 text-sm text-gray-900">
                  {formData.rateLimit.toLocaleString()} requests per hour
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-500">Expiration</div>
                <div className="mt-1 text-sm text-gray-900">
                  {formData.expiresIn
                    ? `${formData.expiresIn} days`
                    : 'Never'}
                </div>
              </div>

              {formData.ipWhitelist && (
                <div>
                  <div className="text-sm font-medium text-gray-500">IP Whitelist</div>
                  <div className="mt-1 text-sm text-gray-900 font-mono">
                    {formData.ipWhitelist.split('\n').filter(ip => ip.trim()).length} IP(s) configured
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={step === 1 ? handleClose : prevStep}
            className="btn-secondary"
          >
            {step === 1 ? (
              'Cancel'
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </>
            )}
          </button>

          {step < 4 ? (
            <button type="button" onClick={nextStep} className="btn-primary">
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary disabled:opacity-50"
            >
              {isSubmitting ? 'Generating...' : 'Generate Key'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
};
