import { Observable } from 'rx';
// import debug from ';
import dedent from 'dedent';

import {
  getSocialProvider,
  getUsernameFromProvider,
  createUserUpdatesFromProfile
} from '../../server/utils/auth';
import { observeMethod, observeQuery } from '../../server/utils/rx';
import { wrapHandledError } from '../../server/utils/create-handled-error.js';

// const debug = debugFactory('fcc:models:userIdent');

export default function(UserIdent) {
  UserIdent.on('dataSourceAttached', () => {
    UserIdent.findOne$ = observeMethod(UserIdent, 'findOne');
  });
  // original source
  // github.com/strongloop/loopback-component-passport
  UserIdent.login = function(
    _provider,
    authScheme,
    profile,
    credentials,
    options,
    cb
  ) {
    const User = UserIdent.app.models.User;
    const AccessToken = UserIdent.app.models.AccessToken;
    const provider = getSocialProvider(_provider);
    options = options || {};
    if (typeof options === 'function' && !cb) {
      cb = options;
      options = {};
    }
    profile.id = profile.id || profile.openid;
    const query = {
      where: {
        provider: provider,
        externalId: profile.id
      },
      include: 'user'
    };
    return UserIdent.findOne$(query)
      .flatMap(identity => {
        if (!identity) {
          throw wrapHandledError(
            new Error('user identity account not found'),
            {
              message: dedent`
                New accounts can only be created using an email address.
                Please create an account below
              `,
              type: 'info',
              redirectTo: '/signin'
            }
          );
        }
        const modified = new Date();
        const user = identity.user();
        if (!user) {
          const username = getUsernameFromProvider(provider, profile);
          return observeQuery(
            identity,
            'updateAttributes',
            {
              isOrphaned: username || true
            }
          )
            .do(() => {
              throw wrapHandledError(
                new Error('user identity is not associated with a user'),
                {
                  type: 'info',
                  redirectTo: '/signin',
                  message: dedent`
We couldn't find a freeCodeCamp account
associated with your ${provider} account.
Try signing in with a different service or with an email address.
                  `
                }
              );
            });
        }
        const updateUser = User.update$(
          { id: user.id },
          createUserUpdatesFromProfile(provider, profile)
        ).map(() => user);
        // identity already exists
        // find user and log them in
        identity.credentials = credentials;
        const attributes = {
          // we no longer want to keep the profile
          // this is information we do not need or use
          profile: null,
          credentials: credentials,
          modified
        };
        const updateIdentity = observeQuery(
          identity,
          'updateAttributes',
          attributes
        );
        const createToken = observeQuery(
          AccessToken,
          'create',
          {
            userId: user.id,
            created: new Date(),
            ttl: user.constructor.settings.ttl
          }
        );
        return Observable.combineLatest(
          updateUser,
          updateIdentity,
          createToken,
          (user, identity, token) => ({ user, identity, token })
        );
      })
      .subscribe(
        ({ user, identity, token }) => cb(null, user, identity, token),
        cb
      );
  };
}
