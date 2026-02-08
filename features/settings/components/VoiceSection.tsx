'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  useVoiceConfigQuery,
  useEnableVoiceMutation,
} from '@/lib/query/hooks/useVoiceCallsQuery';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import {
  Phone,
  Key,
  Save,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  Mic,
  Volume2,
  Power,
} from 'lucide-react';

// =============================================================================
// VoiceSection
// =============================================================================

export const VoiceSection: React.FC = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const orgId = profile?.organization_id;

  const { data: voiceConfig, isLoading: configLoading } = useVoiceConfigQuery();
  const enableVoice = useEnableVoiceMutation();
  const queryClient = useQueryClient();

  // Local state
  const [apiKey, setApiKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'valid' | 'invalid'
  >('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing key from DB (masked)
  useEffect(() => {
    if (!orgId || !supabase) return;

    supabase
      .from('organization_settings')
      .select('elevenlabs_api_key')
      .eq('organization_id', orgId)
      .single()
      .then(({ data }) => {
        if (data?.elevenlabs_api_key) {
          setSavedKey(data.elevenlabs_api_key);
          setApiKey(data.elevenlabs_api_key);
          setValidationStatus('valid');
        }
      });
  }, [orgId]);

  const hasUnsavedChanges = apiKey !== savedKey;
  const isEnabled = voiceConfig?.voice_enabled && voiceConfig?.elevenlabs_agent_id;

  // ─── Validate API key against ElevenLabs ───

  async function validateApiKey(key: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─── Save key + enable voice ───

  async function handleSave() {
    if (!apiKey.trim() || !orgId || !supabase) return;

    setIsSaving(true);
    setValidationStatus('validating');
    setValidationError(null);
    setSuccessMessage(null);

    try {
      // 1. Validate
      const isValid = await validateApiKey(apiKey);
      if (!isValid) {
        setValidationStatus('invalid');
        setValidationError('Chave inválida. Verifique sua API key no painel da ElevenLabs.');
        setIsSaving(false);
        return;
      }

      setValidationStatus('valid');

      // 2. Save key to DB
      await supabase
        .from('organization_settings')
        .update({ elevenlabs_api_key: apiKey })
        .eq('organization_id', orgId);

      setSavedKey(apiKey);

      // 3. Enable voice if not yet enabled (creates ElevenLabs agent)
      if (!isEnabled) {
        await enableVoice.mutateAsync({ apiKey });
        setSuccessMessage('Voice habilitado! Agent ElevenLabs criado.');
      } else {
        setSuccessMessage('Chave atualizada.');
      }

      // 4. Invalidate queries
      queryClient.invalidateQueries({ queryKey: queryKeys.voice.all });
    } catch (error) {
      setValidationStatus('invalid');
      setValidationError(
        error instanceof Error ? error.message : 'Erro ao salvar configuração.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Remove key + disable voice ───

  async function handleRemove() {
    if (!orgId || !supabase) return;

    setIsRemoving(true);
    setSuccessMessage(null);

    try {
      await supabase
        .from('organization_settings')
        .update({
          elevenlabs_api_key: null,
          voice_enabled: false,
          elevenlabs_agent_id: null,
        })
        .eq('organization_id', orgId);

      setApiKey('');
      setSavedKey('');
      setValidationStatus('idle');
      setValidationError(null);
      setSuccessMessage('Voice desabilitado.');

      queryClient.invalidateQueries({ queryKey: queryKeys.voice.all });
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : 'Erro ao remover configuração.'
      );
    } finally {
      setIsRemoving(false);
    }
  }

  // ─── Render ───

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
          <Phone className="h-5 w-5" /> Voice AI
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Apenas administradores podem configurar Voice AI.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Phone className="h-5 w-5" /> Voice AI (ElevenLabs)
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Chamadas de voz com IA para qualificação de leads diretamente do cockpit do deal.
          </p>
        </div>

        {/* Status badge */}
        {configLoading ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando
          </span>
        ) : isEnabled ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-500/30">
            <Power className="h-3 w-3" /> Ativo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            <Power className="h-3 w-3" /> Inativo
          </span>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-xl bg-slate-50 dark:bg-white/3 border border-slate-100 dark:border-white/5 p-4 mb-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          Como funciona:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-start gap-2">
            <Mic className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Vendedor inicia chamada de voz no cockpit do deal
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Volume2 className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              IA conversa com o lead usando contexto do deal (BANT)
            </p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Transcript salvo, BANT extraído, estágio avaliado automaticamente
            </p>
          </div>
        </div>
      </div>

      {/* API Key input */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
            <Key className="h-4 w-4" /> API Key da ElevenLabs
          </label>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setValidationStatus('idle');
                  setValidationError(null);
                  setSuccessMessage(null);
                }}
                placeholder="xi_..."
                className={`w-full bg-slate-50 dark:bg-slate-800 border rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all ${
                  validationStatus === 'invalid'
                    ? 'border-red-300 dark:border-red-500/50'
                    : validationStatus === 'valid'
                      ? 'border-green-300 dark:border-green-500/50'
                      : 'border-slate-200 dark:border-white/10'
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {validationStatus === 'validating' ? (
                  <Loader2 size={16} className="text-purple-500 animate-spin" />
                ) : validationStatus === 'valid' ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : validationStatus === 'invalid' ? (
                  <AlertCircle size={16} className="text-red-500" />
                ) : apiKey ? (
                  <AlertCircle size={16} className="text-amber-500" />
                ) : null}
              </div>
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={
                isSaving ||
                !apiKey.trim() ||
                (!hasUnsavedChanges && validationStatus === 'valid')
              }
              className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all whitespace-nowrap ${
                isSaving ||
                !apiKey.trim() ||
                (!hasUnsavedChanges && validationStatus === 'valid')
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {isEnabled ? 'Salvando...' : 'Ativando...'}
                </>
              ) : (
                <>
                  <Save size={16} />
                  {!savedKey
                    ? 'Ativar Voice'
                    : hasUnsavedChanges
                      ? 'Salvar'
                      : 'Salvo'}
                </>
              )}
            </button>

            {/* Remove button */}
            {savedKey && (
              <button
                onClick={handleRemove}
                disabled={isRemoving}
                className="px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1 transition-all text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-500/30"
              >
                {isRemoving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Validation error */}
        {validationError && (
          <div className="rounded-lg p-3 flex items-start gap-2 bg-red-50 dark:bg-red-900/10 text-red-800 dark:text-red-200 border border-red-100 dark:border-red-500/20">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p className="text-sm">{validationError}</p>
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div className="rounded-lg p-3 flex items-start gap-2 bg-green-50 dark:bg-green-900/10 text-green-800 dark:text-green-200 border border-green-100 dark:border-green-500/20">
            <CheckCircle size={16} className="mt-0.5 shrink-0" />
            <p className="text-sm">{successMessage}</p>
          </div>
        )}

        {/* Agent info when enabled */}
        {isEnabled && voiceConfig?.elevenlabs_agent_id && (
          <div className="rounded-lg p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-500/20">
            <p className="text-xs text-purple-700 dark:text-purple-300">
              <span className="font-medium">Agent ID:</span>{' '}
              <code className="bg-purple-100 dark:bg-purple-800/30 px-1.5 py-0.5 rounded text-xs">
                {voiceConfig.elevenlabs_agent_id}
              </code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
