/// <reference types="cypress" />

describe('https://github.com/single-spa/single-spa-angular/issues/234', () => {
  it('should mount the same parcel multiple times', () => {
    cy.visit('/chat');

    cy.get('.parcel-wrapper').find('img').should('have.length', 2);
  });
});
