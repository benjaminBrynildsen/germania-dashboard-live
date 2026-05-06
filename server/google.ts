import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import db from './db.js';

function getAuthClient(userId: number): OAuth2Client {
  const user = db.prepare('SELECT google_access_token, google_refresh_token FROM users WHERE id = ?').get(userId) as any;
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
  });
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.prepare('UPDATE users SET google_access_token = ? WHERE id = ?').run(tokens.access_token, userId);
    }
  });
  return oauth2Client;
}

export async function createIdeaForm(userId: number, launchName: string, season: string, year: number) {
  const auth = getAuthClient(userId);
  const forms = google.forms({ version: 'v1', auth });

  const form = await forms.forms.create({
    requestBody: {
      info: {
        title: `${launchName} - Drink Ideas (${season} ${year})`,
        documentTitle: `${launchName} - Idea Submission`,
      },
    },
  });

  const formId = form.data.formId!;

  await forms.forms.batchUpdate({
    formId,
    requestBody: {
      requests: [
        {
          createItem: {
            item: {
              title: 'Drink Name',
              questionItem: {
                question: { required: true, textQuestion: { paragraph: false } },
              },
            },
            location: { index: 0 },
          },
        },
        {
          createItem: {
            item: {
              title: 'Description / Flavor Profile',
              questionItem: {
                question: { required: true, textQuestion: { paragraph: true } },
              },
            },
            location: { index: 1 },
          },
        },
        {
          createItem: {
            item: {
              title: 'Inspiration / Notes',
              questionItem: {
                question: { required: false, textQuestion: { paragraph: true } },
              },
            },
            location: { index: 2 },
          },
        },
        {
          createItem: {
            item: {
              title: 'Your Name',
              questionItem: {
                question: { required: true, textQuestion: { paragraph: false } },
              },
            },
            location: { index: 3 },
          },
        },
      ],
    },
  });

  return { formId, responderUri: form.data.responderUri };
}

export async function createVotingForm(userId: number, launchName: string, drinks: { name: string; description: string }[]) {
  const auth = getAuthClient(userId);
  const forms = google.forms({ version: 'v1', auth });

  const form = await forms.forms.create({
    requestBody: {
      info: {
        title: `${launchName} - Menu Voting`,
        documentTitle: `${launchName} - Vote on Drinks`,
      },
    },
  });

  const formId = form.data.formId!;

  const requests = drinks.map((drink, index) => ({
    createItem: {
      item: {
        title: `${drink.name}`,
        description: drink.description,
        questionItem: {
          question: {
            required: true,
            scaleQuestion: {
              low: 1,
              high: 5,
              lowLabel: 'Not interested',
              highLabel: 'Must have!',
            },
          },
        },
      },
      location: { index },
    },
  }));

  await forms.forms.batchUpdate({ formId, requestBody: { requests } });

  return { formId, responderUri: form.data.responderUri };
}

export async function getFormResponses(userId: number, formId: string) {
  const auth = getAuthClient(userId);
  const forms = google.forms({ version: 'v1', auth });
  const res = await forms.forms.responses.list({ formId });
  return res.data.responses || [];
}

export async function createDriveFolder(userId: number, launchName: string, season: string, year: number) {
  const auth = getAuthClient(userId);
  const drive = google.drive({ version: 'v3', auth });

  const folder = await drive.files.create({
    requestBody: {
      name: `${launchName} - ${season} ${year}`,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  const folderId = folder.data.id!;

  const subfolders = ['SOPs', 'Menu Designs', 'Photos', 'Recipes'];
  for (const name of subfolders) {
    await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [folderId],
      },
    });
  }

  return folderId;
}
