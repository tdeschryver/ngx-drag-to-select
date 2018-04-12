/// <reference types="cypress" />

describe('Demo App', () => {
  it('should display headline', () => {
    cy.visit('/');

    // Because in our HTML there are line breaks
    // see: https://github.com/cypress-io/cypress/issues/92
    cy.get('ngx-root h1').contains(`Angular
    Drag-to-Select
    Component`);
  });
});
