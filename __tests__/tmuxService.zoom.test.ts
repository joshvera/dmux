import { afterEach, describe, expect, it, vi } from 'vitest';
import { TmuxService } from '../src/services/TmuxService.js';

describe('TmuxService setPaneZoom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when the window is already in the requested zoom state', async () => {
    const service = TmuxService.getInstance();
    const isWindowZoomedSpy = vi
      .spyOn(service, 'isWindowZoomed')
      .mockResolvedValue(true);
    const togglePaneZoomSpy = vi
      .spyOn(service, 'togglePaneZoom')
      .mockResolvedValue();

    await service.setPaneZoom('%1', true);

    expect(isWindowZoomedSpy).toHaveBeenCalledWith('%1');
    expect(togglePaneZoomSpy).not.toHaveBeenCalled();
  });

  it('toggles zoom when the requested state differs from the current state', async () => {
    const service = TmuxService.getInstance();
    const isWindowZoomedSpy = vi
      .spyOn(service, 'isWindowZoomed')
      .mockResolvedValue(false);
    const togglePaneZoomSpy = vi
      .spyOn(service, 'togglePaneZoom')
      .mockResolvedValue();

    await service.setPaneZoom('%1', true);

    expect(isWindowZoomedSpy).toHaveBeenCalledWith('%1');
    expect(togglePaneZoomSpy).toHaveBeenCalledWith('%1');
  });
});
