import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Calendar, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useSyncBridge } from "@/hooks/useSyncBridge";

// Import logos
import logoGoogleCalendar from "@/assets/logo-google-calendar.png";
import logoClickUp from "@/assets/logo-clickup.png";
import logoNotion from "@/assets/logo-notion.png";
import logoHubSpot from "@/assets/logo-hubspot.png";
import logoTickTick from "@/assets/logo-ticktick.png";
import logoTodoist from "@/assets/logo-todoist.png";
import logoEvernote from "@/assets/logo-evernote.png";

interface ConnectionStatus {
  connected: boolean;
  lastSync?: string;
  email?: string;
}

interface SyncSettingsState {
  calendar: {
    enabled: boolean;
    twoWaySync: boolean;
    defaultCalendar: string;
  };
  integrations: {
    clickup: ConnectionStatus;
    notion: ConnectionStatus;
    hubspot: ConnectionStatus;
  };
  imports: {
    ticktick: ConnectionStatus;
    todoist: ConnectionStatus;
  };
}

const SyncSettings = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  
  const {
    isLoading: bridgeLoading,
    calendarSettings,
    connections,
    lastSyncTime,
    connectGoogleCalendar,
  } = useSyncBridge();
  
  const [settings, setSettings] = useState<SyncSettingsState>({
    calendar: {
      enabled: false,
      twoWaySync: true,
      defaultCalendar: "",
    },
    integrations: {
      clickup: { connected: false },
      notion: { connected: false },
      hubspot: { connected: false },
    },
    imports: {
      ticktick: { connected: false },
      todoist: { connected: false },
    },
  });

  useEffect(() => {
    if (!bridgeLoading) {
      setSettings(prev => ({
        ...prev,
        calendar: calendarSettings,
        integrations: {
          clickup: connections.clickup,
          notion: connections.notion,
          hubspot: connections.hubspot,
        },
        imports: {
          ticktick: connections.ticktick,
          todoist: connections.todoist,
        },
      }));
    }
  }, [bridgeLoading, calendarSettings, connections]);

  const handleConnect = async (service: string) => {
    setIsLoading(prev => ({ ...prev, [service]: true }));
    
    try {
      if (service === "Google Calendar") {
        const result = await connectGoogleCalendar();
        if (result.success) {
          toast({
            title: t('toasts.connected'),
            description: t('toasts.connectedAs', { email: result.email }),
          });
        } else {
          toast({
            title: t('toasts.connectionFailed'),
            description: result.error || t('toasts.failedToConnect'),
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: t('toasts.comingSoon'),
          description: t('toasts.integrationComingSoon', { service }),
        });
      }
    } catch (error) {
      toast({
        title: t('errors.generic'),
        description: t('toasts.failedToConnect'),
        variant: "destructive",
      });
    }
    
    setIsLoading(prev => ({ ...prev, [service]: false }));
  };

  if (bridgeLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const connectButtonStyles = "w-full h-12 justify-start gap-3 border border-border bg-background hover:bg-muted/50 text-foreground font-medium rounded-xl";

  return (
    <div className="space-y-6 p-4 max-w-2xl mx-auto">

      {lastSyncTime && (
        <div className="text-xs text-muted-foreground text-center">
          {t('sync.lastSynced', { time: new Date(lastSyncTime).toLocaleString() })}
        </div>
      )}

      {/* Google Calendar Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-background">
              <img src={logoGoogleCalendar} alt="Google Calendar" className="h-8 w-8" />
            </div>
            <div>
              <CardTitle className="text-lg">Google Calendar</CardTitle>
              <CardDescription>{t('sync.syncWithCalendar')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button 
            variant="outline" 
            className={connectButtonStyles}
            onClick={() => handleConnect("Google Calendar")}
            disabled={isLoading["Google Calendar"]}
          >
            {isLoading["Google Calendar"] ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <img 
                src="https://www.google.com/favicon.ico" 
                alt="Google" 
                className="h-5 w-5"
              />
            )}
            {connections.googleCalendar.connected ? t('toasts.connected') : t('sync.continueAccount', { service: 'Google' })}
          </Button>
          {connections.googleCalendar.email && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {t('toasts.connectedAs', { email: connections.googleCalendar.email })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Integrations Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('sync.integrations')}</CardTitle>
          <CardDescription>{t('sync.integrationsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {/* ClickUp */}
            <AccordionItem value="clickup" className="border-b">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <img src={logoClickUp} alt="ClickUp" className="w-8 h-8 rounded-lg" />
                  <span className="font-medium">ClickUp</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <Button 
                  variant="outline" 
                  className={connectButtonStyles}
                  onClick={() => handleConnect("ClickUp")}
                  disabled={isLoading["ClickUp"]}
                >
                  {isLoading["ClickUp"] ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <img src={logoClickUp} alt="ClickUp" className="h-5 w-5 rounded" />
                  )}
                  {t('sync.continueAccount', { service: 'ClickUp' })}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Notion */}
            <AccordionItem value="notion" className="border-b">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <img src={logoNotion} alt="Notion" className="w-8 h-8 rounded-lg" />
                  <span className="font-medium">Notion</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <Button 
                  variant="outline" 
                  className={connectButtonStyles}
                  onClick={() => handleConnect("Notion")}
                  disabled={isLoading["Notion"]}
                >
                  {isLoading["Notion"] ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <img src={logoNotion} alt="Notion" className="h-5 w-5 rounded" />
                  )}
                  {t('sync.continueAccount', { service: 'Notion' })}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* HubSpot */}
            <AccordionItem value="hubspot" className="border-b-0">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <img src={logoHubSpot} alt="HubSpot" className="w-8 h-8 rounded-lg" />
                  <span className="font-medium">HubSpot</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <Button 
                  variant="outline" 
                  className={connectButtonStyles}
                  onClick={() => handleConnect("HubSpot")}
                  disabled={isLoading["HubSpot"]}
                >
                  {isLoading["HubSpot"] ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <img src={logoHubSpot} alt="HubSpot" className="h-5 w-5 rounded" />
                  )}
                  {t('sync.continueAccount', { service: 'HubSpot' })}
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Task Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('sync.importTasks')}</CardTitle>
          <CardDescription>{t('sync.importTasksDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {/* TickTick */}
            <AccordionItem value="ticktick" className="border-b">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <img src={logoTickTick} alt="TickTick" className="w-8 h-8 rounded-lg" />
                  <span className="font-medium">TickTick</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <Button 
                  variant="outline" 
                  className={connectButtonStyles}
                  onClick={() => handleConnect("TickTick")}
                  disabled={isLoading["TickTick"]}
                >
                  {isLoading["TickTick"] ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <img src={logoTickTick} alt="TickTick" className="h-5 w-5 rounded" />
                  )}
                  {t('sync.importFrom', { service: 'TickTick' })}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Todoist */}
            <AccordionItem value="todoist" className="border-b">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <img src={logoTodoist} alt="Todoist" className="w-8 h-8 rounded-lg" />
                  <span className="font-medium">Todoist</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <Button 
                  variant="outline" 
                  className={connectButtonStyles}
                  onClick={() => handleConnect("Todoist")}
                  disabled={isLoading["Todoist"]}
                >
                  {isLoading["Todoist"] ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <img src={logoTodoist} alt="Todoist" className="h-5 w-5 rounded" />
                  )}
                  {t('sync.importFrom', { service: 'Todoist' })}
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Evernote */}
            <AccordionItem value="evernote" className="border-b-0">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <img src={logoEvernote} alt="Evernote" className="w-8 h-8 rounded-lg" />
                  <span className="font-medium">Evernote</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <Button 
                  variant="outline" 
                  className={connectButtonStyles}
                  onClick={() => handleConnect("Evernote")}
                  disabled={isLoading["Evernote"]}
                >
                  {isLoading["Evernote"] ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <img src={logoEvernote} alt="Evernote" className="h-5 w-5 rounded" />
                  )}
                  {t('sync.importFrom', { service: 'Evernote' })}
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
};

export default SyncSettings;
