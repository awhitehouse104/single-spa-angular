import { NgModuleRef, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { LifeCycles } from 'single-spa';
import {
  getContainerElementAndSetTemplate,
  removeApplicationFromDOMIfIvyEnabled,
} from 'single-spa-angular/internals';

import { SingleSpaPlatformLocation } from './extra-providers';
import { SingleSpaAngularOptions, BootstrappedSingleSpaAngularOptions } from './types';

const defaultOptions = {
  // Required options that will be set by the library consumer.
  NgZone: null!,
  bootstrapFunction: null!,
  template: null!,
  // Optional options
  Router: undefined,
  domElementGetter: undefined, // only optional if you provide a domElementGetter as a custom prop
  AnimationEngine: undefined,
  updateFunction: () => Promise.resolve(),
  bootstrappedModule: null,
};

export function singleSpaAngular<T>(userOptions: SingleSpaAngularOptions<T>): LifeCycles<T> {
  if (typeof userOptions !== 'object') {
    throw Error('single-spa-angular requires a configuration object');
  }

  const options: SingleSpaAngularOptions = {
    ...defaultOptions,
    ...userOptions,
  };

  if (typeof options.bootstrapFunction !== 'function') {
    throw Error('single-spa-angular must be passed an options.bootstrapFunction');
  }

  if (typeof options.template !== 'string') {
    throw Error('single-spa-angular must be passed options.template string');
  }

  if (!options.NgZone) {
    throw Error(`single-spa-angular must be passed the NgZone option`);
  }

  if (options.Router && !options.NavigationStart) {
    // We call `console.warn` except of throwing `new Error()` since this will not
    // be a breaking change.
    console.warn(`single-spa-angular must be passed the NavigationStart option`);
  }

  return {
    bootstrap: bootstrap.bind(null, options as BootstrappedSingleSpaAngularOptions),
    mount: mount.bind(null, options),
    unmount: unmount.bind(null, options as BootstrappedSingleSpaAngularOptions),
    update: options.updateFunction,
  };
}

async function bootstrap(options: BootstrappedSingleSpaAngularOptions, props: any): Promise<void> {
  options.instances = options.instances || {};
  const instance = (options.instances[props.name || props.appName] =
    options.instances[props.name || props.appName] || {});

  // Angular provides an opportunity to develop `zone-less` application, where developers
  // have to trigger change detection manually.
  // See https://angular.io/guide/zone#noopzone
  if (options.NgZone === 'noop') {
    return;
  }

  // In order for multiple Angular apps to work concurrently on a page, they each need a unique identifier.
  instance.zoneIdentifier = `single-spa-angular:${props.name || props.appName}`;

  // This is a hack, since NgZone doesn't allow you to configure the property that identifies your zone.
  // See https://github.com/PlaceMe-SAS/single-spa-angular-cli/issues/33,
  // https://github.com/single-spa/single-spa-angular/issues/47,
  // https://github.com/angular/angular/blob/a14dc2d7a4821a19f20a9547053a5734798f541e/packages/core/src/zone/ng_zone.ts#L144,
  // and https://github.com/angular/angular/blob/a14dc2d7a4821a19f20a9547053a5734798f541e/packages/core/src/zone/ng_zone.ts#L257
  options.NgZone.isInAngularZone = () => {
    // @ts-ignore
    return window.Zone.current._properties[instance.zoneIdentifier] === true;
  };

  instance.routingEventListener = () => {
    instance.bootstrappedNgZone!.run(() => {
      // See https://github.com/single-spa/single-spa-angular/issues/86
      // Zone is unaware of the single-spa navigation change and so Angular change detection doesn't work
      // unless we tell Zone that something happened
    });
  };
}

async function mount(options: SingleSpaAngularOptions, props: any): Promise<NgModuleRef<any>> {
  getContainerElementAndSetTemplate(options, props);

  const bootstrapPromise = options.bootstrapFunction(props);

  if (!(bootstrapPromise instanceof Promise)) {
    throw Error(
      `single-spa-angular: the options.bootstrapFunction must return a promise, but instead returned a '${typeof bootstrapPromise}' that is not a Promise`,
    );
  }

  const module: NgModuleRef<any> = await bootstrapPromise;

  if (!module || typeof module.destroy !== 'function') {
    throw Error(
      `single-spa-angular: the options.bootstrapFunction returned a promise that did not resolve with a valid Angular module. Did you call platformBrowserDynamic().bootstrapModule() correctly?`,
    );
  }

  const singleSpaPlatformLocation: SingleSpaPlatformLocation | null = module.injector.get(
    SingleSpaPlatformLocation,
    null,
  );

  const ngZoneEnabled = options.NgZone !== 'noop';

  // The user has to provide `BrowserPlatformLocation` only if his application uses routing.
  // So if he provided `Router` but didn't provide `BrowserPlatformLocation` then we have to inform him.
  // Also `getSingleSpaExtraProviders()` function should be called only if the user doesn't use
  // `zone-less` change detection, if `NgZone` is `noop` then we can skip it.
  if (ngZoneEnabled && options.Router && singleSpaPlatformLocation === null) {
    throw new Error(`
      single-spa-angular: could not retrieve extra providers from the platform injector. Did you call platformBrowserDynamic(getSingleSpaExtraProviders()).bootstrapModule()?
    `);
  }

  const bootstrappedOptions = options as BootstrappedSingleSpaAngularOptions;
  bootstrappedOptions.instances = bootstrappedOptions.instances || {};
  const bootstrappedOptionsInstance =
    bootstrappedOptions.instances[props.name || props.appName] || {};

  if (ngZoneEnabled) {
    const ngZone: NgZone = module.injector.get(options.NgZone);
    const zoneIdentifier: string = bootstrappedOptionsInstance.zoneIdentifier!;

    // `NgZone` can be enabled but routing may not be used thus `getSingleSpaExtraProviders()`
    // function was not called.
    if (singleSpaPlatformLocation !== null) {
      skipLocationChangeOnNonImperativeRoutingTriggers(module, options);

      // Cleanup resources, especially remove event listeners thus they will not be added
      // twice when application gets bootstrapped the second time.
      module.onDestroy(() => {
        singleSpaPlatformLocation.destroyApplication(zoneIdentifier);
      });
    }

    bootstrappedOptionsInstance.bootstrappedNgZone = ngZone;
    bootstrappedOptionsInstance.bootstrappedNgZone['_inner']._properties[zoneIdentifier] = true;
    window.addEventListener(
      `single-spa:routing-event-${props.name || props.appName}`,
      bootstrappedOptionsInstance.routingEventListener!,
    );
  }

  bootstrappedOptionsInstance.bootstrappedModule = module;
  return module;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function unmount(options: BootstrappedSingleSpaAngularOptions, props: any): Promise<void> {
  const instance = options.instances[props.name || props.appName] || {};

  if (options.Router) {
    // Workaround for https://github.com/angular/angular/issues/19079
    const router = instance.bootstrappedModule!.injector.get(options.Router);
    router.dispose();
  }

  if (instance.routingEventListener) {
    window.removeEventListener(
      `single-spa:routing-event-${props.name || props.appName}`,
      instance.routingEventListener,
    );
  }

  if (options.AnimationEngine) {
    /*
    The BrowserAnimationsModule does not clean up after itself :'(. When you unmount/destroy the main module, the
    BrowserAnimationsModule uses an AnimationRenderer thing to remove dom elements from the page. But the AnimationRenderer
    defers the actual work to the TransitionAnimationEngine to do this, and the TransitionAnimationEngine doesn't actually
    remove the dom node, but just calls "markElementAsRemoved()".

    See https://github.com/angular/angular/blob/db62ccf9eb46ee89366ade586365ea027bb93eb1/packages/animations/browser/src/render/transition_animation_engine.ts#L717

    What markAsRemovedDoes is put it into an array called "collectedLeaveElements", which is all the elements that should be removed
    after the DOM has had a chance to do any animations.

    See https://github.com/angular/angular/blob/master/packages/animations/browser/src/render/transition_animation_engine.ts#L525

    The actual dom nodes aren't removed until the TransitionAnimationEngine "flushes".

    See https://github.com/angular/angular/blob/db62ccf9eb46ee89366ade586365ea027bb93eb1/packages/animations/browser/src/render/transition_animation_engine.ts#L851

    Unfortunately, though, that "flush" will never happen, since the entire module is being destroyed and there will be no more flushes.
    So what we do in this code is force one more flush of the animations after the module is destroyed.

    Ideally, we would do this by getting the TransitionAnimationEngine directly and flushing it. Unfortunately, though, it's private class
    that cannot be imported and is not provided to the dependency injector. So, instead, we get its wrapper class, AnimationEngine, and then
    access its private variable reference to the TransitionAnimationEngine so that we can call flush.
    */
    const animationEngine = instance.bootstrappedModule!.injector.get(options.AnimationEngine);
    animationEngine._transitionEngine.flush();
  }

  instance.bootstrappedModule!.destroy();
  instance.bootstrappedModule = null;

  // TODO: this is not an issue anymore and should be removed in the future.
  removeApplicationFromDOMIfIvyEnabled(options, props);
}

function skipLocationChangeOnNonImperativeRoutingTriggers(
  module: NgModuleRef<any>,
  options: SingleSpaAngularOptions,
): void {
  if (!options.NavigationStart) {
    // As discussed we don't do anything right now if the developer doesn't provide
    // `options.NavigationStart` since this might be a breaking change.
    return;
  }

  const router = module.injector.get(options.Router);
  const subscription: Subscription = router.events.subscribe((event: any) => {
    if (event instanceof options.NavigationStart!) {
      const currentNavigation = router.getCurrentNavigation();
      // This listener will be set up for each Angular application
      // that has routing capabilities.
      // We set `skipLocationChange` for each non-imperative navigation,
      // Angular router checks under the hood if it has to change
      // the browser URL or not.
      // If `skipLocationChange` is truthy then Angular router will not call
      // `setBrowserUrl()` which calls `history.replaceState()` and dispatches `popstate` event.
      if (currentNavigation.trigger !== 'imperative') {
        currentNavigation.extras.skipLocationChange = true;
        currentNavigation.extras.replaceUrl = false;
      }
    }
  });

  module.onDestroy(() => {
    subscription.unsubscribe();
  });
}
